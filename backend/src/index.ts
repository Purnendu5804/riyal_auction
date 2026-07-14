import { ServerWebSocket } from "bun";
import { prisma } from "./db.ts";
import { AuctionState, PlayerData, CaptainData, ClientMessage, ServerMessage } from "./types.ts";

interface SocketData {
  roomId: string;
  role: "host" | "captain" | "spectator";
  captainId?: string;
}

type BunWebSocket = ServerWebSocket<SocketData>;

interface RoomState {
  roomCode: string;
  status: "upcoming" | "live" | "paused" | "done";
  currentPlayer: PlayerData | null;
  currentHighestBid: number;
  currentHighestBidderId: string | null;
  playerQueue: string[]; // List of remaining player IDs
  timerSeconds: number;
  timerInterval: Timer | null; // Bun's Timer type
  lastSaleInfo: {
    playerId: string;
    captainId: string;
    soldPrice: number;
  } | null;
  sockets: Set<BunWebSocket>;
  captains: CaptainData[];
}

const activeRooms = new Map<string, RoomState>();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Generates a random uppercase room code (e.g. "RIYAL")
function generateRoomCode(length = 5): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Broadcasts a message to all sockets in a room
function broadcastToRoom(room: RoomState, message: ServerMessage) {
  const payload = JSON.stringify(message);
  for (const ws of room.sockets) {
    ws.send(payload);
  }
}

// Broadcasts a sync snapshot to all sockets in a room
function broadcastSync(room: RoomState) {
  const state: AuctionState = {
    roomCode: room.roomCode,
    status: room.status,
    currentPlayer: room.currentPlayer,
    currentHighestBid: room.currentHighestBid,
    currentHighestBidderId: room.currentHighestBidderId,
    captains: room.captains,
    playerQueue: room.playerQueue,
    timerSeconds: room.timerSeconds,
  };
  broadcastToRoom(room, { type: "sync", state });
}

// Get or restore a room state from DB
async function getOrCreateRoom(roomCode: string): Promise<RoomState | null> {
  const code = roomCode.toUpperCase();
  if (activeRooms.has(code)) {
    return activeRooms.get(code)!;
  }

  const dbAuction = await prisma.auction.findUnique({
    where: { roomCode: code },
  });

  if (!dbAuction) return null;

  // Load captains
  const dbCaptains = await prisma.captain.findMany(); // Simplification: since it's single room, we load all captains
  // Wait, captains are associated with the auction room indirectly, let's load captains
  const captains: CaptainData[] = dbCaptains.map((c) => ({
    id: c.id,
    name: c.name,
    balance: c.balance,
    isOnline: false, // will update when they connect WS
  }));

  // Parse queue
  let queue: string[] = [];
  try {
    queue = JSON.parse(dbAuction.playerQueue);
  } catch (e) {
    queue = [];
  }

  // Load current player if exists
  let currentPlayer: PlayerData | null = null;
  if (dbAuction.currentPlayerId) {
    const dbPlayer = await prisma.player.findUnique({
      where: { id: dbAuction.currentPlayerId },
    });
    if (dbPlayer) {
      currentPlayer = {
        id: dbPlayer.id,
        name: dbPlayer.name,
        position: dbPlayer.position,
        basePrice: dbPlayer.basePrice,
        status: dbPlayer.status as any,
        passCount: dbPlayer.passCount,
        soldPrice: dbPlayer.soldPrice,
        soldToCaptainId: dbPlayer.soldToCaptainId,
      };
    }
  }

  const room: RoomState = {
    roomCode: code,
    status: dbAuction.status as any,
    currentPlayer,
    currentHighestBid: dbAuction.currentHighestBid,
    currentHighestBidderId: dbAuction.currentHighestBidderId,
    playerQueue: queue,
    timerSeconds: 90,
    timerInterval: null,
    lastSaleInfo: null,
    sockets: new Set(),
    captains,
  };

  activeRooms.set(code, room);
  return room;
}

// Clear and reset the bid timer
function clearBidTimer(room: RoomState) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
}

// Resets/starts the bid timer
function resetBidTimer(room: RoomState) {
  clearBidTimer(room);
  room.timerSeconds = 90;

  room.timerInterval = setInterval(() => {
    if (room.status === "paused") return;

    room.timerSeconds -= 1;
    broadcastToRoom(room, { type: "timer:tick", seconds: room.timerSeconds });

    if (room.timerSeconds <= 0) {
      clearBidTimer(room);
      handleTimerExpiry(room);
    }
  }, 1000);
}

// Handle timer expiry (sold or unsold)
async function handleTimerExpiry(room: RoomState) {
  if (room.currentHighestBidderId && room.currentPlayer) {
    // Player is sold!
    const bidderId = room.currentHighestBidderId;
    const amount = room.currentHighestBid;
    const player = room.currentPlayer;

    const captain = room.captains.find((c) => c.id === bidderId);
    if (captain) {
      captain.balance -= amount;
      player.status = "sold";
      player.soldPrice = amount;
      player.soldToCaptainId = bidderId;

      console.log(`[Timer Expiry] Player ${player.name} sold to ${captain.name} for ${amount} Riyal Coins`);

      // Database Checkpoint
      await prisma.$transaction([
        prisma.captain.update({
          where: { id: bidderId },
          data: { balance: captain.balance },
        }),
        prisma.player.update({
          where: { id: player.id },
          data: {
            status: "sold",
            soldPrice: amount,
            soldToCaptainId: bidderId,
          },
        }),
        prisma.bidLog.create({
          data: {
            auctionId: room.roomCode,
            captainId: bidderId,
            playerId: player.id,
            amount: amount,
          },
        }),
      ]);

      // Remove from queue
      room.playerQueue = room.playerQueue.filter((id) => id !== player.id);

      // Save queue
      await prisma.auction.update({
        where: { roomCode: room.roomCode },
        data: {
          playerQueue: JSON.stringify(room.playerQueue),
          currentPlayerId: null,
          currentHighestBid: 0,
          currentHighestBidderId: null,
        },
      });

      broadcastToRoom(room, {
        type: "player:sold",
        player,
        captainId: bidderId,
        price: amount,
      });

      // Keep record of last sale for undo
      room.lastSaleInfo = {
        playerId: player.id,
        captainId: bidderId,
        soldPrice: amount,
      };
    }

    room.currentPlayer = null;
    room.currentHighestBid = 0;
    room.currentHighestBidderId = null;

    if (room.playerQueue.length === 0) {
      room.status = "done";
      await prisma.auction.update({
        where: { roomCode: room.roomCode },
        data: { status: "done" },
      });
      broadcastSync(room);
    } else {
      // Put next player on block automatically
      await putNextPlayerOnBlock(room);
    }
  } else if (room.currentPlayer) {
    // Player went unsold!
    const player = room.currentPlayer;
    player.passCount += 1;

    const MAX_PASSES = 2;
    let isSkipped = false;

    if (player.passCount >= MAX_PASSES) {
      player.status = "skipped";
      isSkipped = true;
      room.playerQueue = room.playerQueue.filter((id) => id !== player.id);
      console.log(`[Timer Expiry] Player ${player.name} permanently skipped (passed ${player.passCount} times)`);
    } else {
      // Requeue: pop from front, push to back
      room.playerQueue = room.playerQueue.filter((id) => id !== player.id);
      room.playerQueue.push(player.id);
      console.log(`[Timer Expiry] Player ${player.name} went unsold, requeued to back`);
    }

    // Persist status
    await prisma.player.update({
      where: { id: player.id },
      data: {
        status: player.status,
        passCount: player.passCount,
      },
    });

    await prisma.auction.update({
      where: { roomCode: room.roomCode },
      data: {
        playerQueue: JSON.stringify(room.playerQueue),
        currentPlayerId: null,
        currentHighestBid: 0,
        currentHighestBidderId: null,
      },
    });

    if (isSkipped) {
      broadcastToRoom(room, {
        type: "player:skipped",
        player,
      });
    } else {
      broadcastToRoom(room, {
        type: "notification",
        message: `${player.name} went unsold and was requeued.`,
      });
    }

    room.currentPlayer = null;
    room.currentHighestBid = 0;
    room.currentHighestBidderId = null;

    // Immediately put the next player on the block
    await putNextPlayerOnBlock(room);
  }
}

// Load the next player in the queue onto the block
async function putNextPlayerOnBlock(room: RoomState) {
  clearBidTimer(room);

  if (room.playerQueue.length === 0) {
    room.status = "done";
    room.currentPlayer = null;
    await prisma.auction.update({
      where: { roomCode: room.roomCode },
      data: { status: "done", currentPlayerId: null },
    });
    broadcastSync(room);
    return;
  }

  const nextPlayerId = room.playerQueue[0];
  const dbPlayer = await prisma.player.findUnique({
    where: { id: nextPlayerId },
  });

  if (!dbPlayer) {
    // If player not found, remove from queue and try next
    room.playerQueue.shift();
    await putNextPlayerOnBlock(room);
    return;
  }

  room.currentPlayer = {
    id: dbPlayer.id,
    name: dbPlayer.name,
    position: dbPlayer.position,
    basePrice: dbPlayer.basePrice,
    status: dbPlayer.status as any,
    passCount: dbPlayer.passCount,
    soldPrice: dbPlayer.soldPrice,
    soldToCaptainId: dbPlayer.soldToCaptainId,
  };
  room.currentHighestBid = 0;
  room.currentHighestBidderId = null;
  room.status = "live";

  // Checkpoint to DB
  await prisma.auction.update({
    where: { roomCode: room.roomCode },
    data: {
      currentPlayerId: dbPlayer.id,
      currentHighestBid: 0,
      currentHighestBidderId: null,
      status: "live",
    },
  });

  // Start the 90-second countdown immediately for the new player
  resetBidTimer(room);

  broadcastToRoom(room, {
    type: "auction:player-on-block",
  });
  broadcastSync(room);
}

// Start Bun Serve
const server = Bun.serve<SocketData>({
  port: process.env.PORT || 8080,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    // 1. Create room (Host only)
    if (url.pathname === "/api/create" && req.method === "POST") {
      try {
        const roomCode = generateRoomCode();
        
        // Find all available players to initialize queue
        const dbPlayers = await prisma.player.findMany({
          where: { status: "available" }
        });
        
        // Shuffle the player queue randomly
        const playerQueue = dbPlayers
          .map((p) => p.id)
          .sort(() => Math.random() - 0.5);

        await prisma.auction.create({
          data: {
            roomCode,
            status: "upcoming",
            playerQueue: JSON.stringify(playerQueue)
          }
        });

        console.log(`[API] Created auction room with code ${roomCode}`);
        return new Response(JSON.stringify({ success: true, roomCode }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          status: 200,
        });
      } catch (err: any) {
        console.error("[API] Error creating room:", err);
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }

    // 2. Join room (Captain only)
    if (url.pathname === "/api/join" && req.method === "POST") {
      try {
        const { roomCode, name: inputName } = await req.json();
        const code = roomCode?.toUpperCase();

        if (!code || !inputName) {
          return new Response(JSON.stringify({ success: false, error: "Missing roomCode or name" }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            status: 400,
          });
        }

        const allowedCaptains = ["Lionel Messi", "Cristiano Gupta", "Lionel Gupta"];
        const name = allowedCaptains.find(c => c.toLowerCase() === inputName.trim().toLowerCase());

        if (!name) {
          return new Response(JSON.stringify({ success: false, error: "Invalid captain name. Only 'Lionel Messi', 'Cristiano Gupta', or 'Lionel Gupta' can join." }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            status: 400,
          });
        }

        const dbAuction = await prisma.auction.findUnique({
          where: { roomCode: code },
        });

        if (!dbAuction) {
          return new Response(JSON.stringify({ success: false, error: "Room not found" }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            status: 404,
          });
        }

        if (dbAuction.status === "done") {
          return new Response(JSON.stringify({ success: false, error: "Auction is already completed" }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            status: 400,
          });
        }

        // Get or load active room
        const room = await getOrCreateRoom(code);
        if (!room) {
          return new Response(JSON.stringify({ success: false, error: "Could not create/load room" }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            status: 500,
          });
        }

        // Check current captains
        const existingCaptain = room.captains.find((c) => c.name.toLowerCase() === name.toLowerCase());

        if (existingCaptain) {
          // Allow reconnecting: retrieve the existing captain's database record to get token
          const dbCaptain = await prisma.captain.findUnique({
            where: { id: existingCaptain.id },
          });
          return new Response(
            JSON.stringify({
              success: true,
              token: dbCaptain?.sessionToken,
              captainId: existingCaptain.id,
              balance: existingCaptain.balance,
              name: existingCaptain.name,
            }),
            { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
          );
        }

        if (room.captains.length >= 2) {
          return new Response(JSON.stringify({ success: false, error: "Room is full (max 2 captains)" }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            status: 400,
          });
        }

        let startingBalance = 500;
        if (name === "Lionel Yadav") startingBalance = 355;
        if (name === "Cristiano Gupta") startingBalance = 110;

        const sessionToken = crypto.randomUUID();
        const dbCaptain = await prisma.captain.create({
          data: {
            name,
            balance: startingBalance,
            sessionToken,
          },
        });

        const newCaptain: CaptainData = {
          id: dbCaptain.id,
          name: dbCaptain.name,
          balance: dbCaptain.balance,
          isOnline: false,
        };
        room.captains.push(newCaptain);

        console.log(`[API] Captain ${name} joined room ${code}`);
        return new Response(
          JSON.stringify({
            success: true,
            token: sessionToken,
            captainId: dbCaptain.id,
            balance: dbCaptain.balance,
            name: dbCaptain.name,
          }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (err: any) {
        console.error("[API] Join Error:", err);
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }

    // 3. Get room details (initial load)
    if (url.pathname.startsWith("/api/room/") && req.method === "GET") {
      const roomCode = url.pathname.split("/").pop()?.toUpperCase();
      if (!roomCode) {
        return new Response(JSON.stringify({ success: false, error: "Missing roomCode" }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          status: 400,
        });
      }

      const room = await getOrCreateRoom(roomCode);
      if (!room) {
        return new Response(JSON.stringify({ success: false, error: "Room not found" }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          status: 404,
        });
      }

      // Load all players list (both sold and skipped) to display in recap
      const dbAllPlayers = await prisma.player.findMany();

      return new Response(
        JSON.stringify({
          success: true,
          state: {
            roomCode: room.roomCode,
            status: room.status,
            currentPlayer: room.currentPlayer,
            currentHighestBid: room.currentHighestBid,
            currentHighestBidderId: room.currentHighestBidderId,
            captains: room.captains,
            playerQueue: room.playerQueue,
            timerSeconds: room.timerSeconds,
          },
          allPlayers: dbAllPlayers,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // 4. Upgrade to WebSocket
    if (url.pathname === "/ws") {
      const roomCode = url.searchParams.get("roomCode")?.toUpperCase();
      const role = url.searchParams.get("role");
      const token = url.searchParams.get("token");

      if (!roomCode || !role) {
        return new Response("Missing roomCode or role", { status: 400 });
      }

      const room = await getOrCreateRoom(roomCode);
      if (!room) {
        return new Response("Room not found", { status: 404 });
      }

      let captainId: string | undefined = undefined;
      if (role === "captain") {
        if (!token) return new Response("Missing token", { status: 401 });
        const dbCaptain = await prisma.captain.findUnique({
          where: { sessionToken: token },
        });
        if (!dbCaptain) return new Response("Invalid captain token", { status: 401 });
        captainId = dbCaptain.id;
      }

      const upgraded = server.upgrade(req, {
        data: {
          roomId: roomCode,
          role: role as any,
          captainId,
        },
      });

      if (upgraded) {
        return undefined;
      } else {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    async open(ws) {
      const { roomId, role, captainId } = ws.data;
      const room = await getOrCreateRoom(roomId);
      if (!room) {
        ws.close(4001, "Room not initialized");
        return;
      }

      room.sockets.add(ws);

      if (role === "captain" && captainId) {
        const captain = room.captains.find((c) => c.id === captainId);
        if (captain) {
          captain.isOnline = true;
          console.log(`[WS] Captain ${captain.name} connected to ${roomId}`);
        }
      } else {
        console.log(`[WS] ${role} connected to ${roomId}`);
      }

      // Send initial state snapshot to the connecting socket
      const state: AuctionState = {
        roomCode: room.roomCode,
        status: room.status,
        currentPlayer: room.currentPlayer,
        currentHighestBid: room.currentHighestBid,
        currentHighestBidderId: room.currentHighestBidderId,
        captains: room.captains,
        playerQueue: room.playerQueue,
        timerSeconds: room.timerSeconds,
      };
      ws.send(JSON.stringify({ type: "sync", state }));

      // Broadcast sync to everyone so online status gets updated
      broadcastSync(room);
    },

    async message(ws, message) {
      const { roomId, role, captainId } = ws.data;
      const room = activeRooms.get(roomId);
      if (!room) return;

      let msg: ClientMessage;
      try {
        msg = JSON.parse(message.toString());
      } catch (e) {
        ws.send(JSON.stringify({ type: "notification", message: "Invalid message format", isError: true }));
        return;
      }

      console.log(`[WS Msg] From ${role} in ${roomId}:`, msg);

      // Handle captain bid placement
      if (msg.type === "bid:place") {
        if (role !== "captain" || !captainId) {
          ws.send(JSON.stringify({ type: "bid:rejected", reason: "Only captains can place bids" }));
          return;
        }

        // Synchronous state-validation checks
        if (room.status !== "live" && room.status !== "bidding") {
          ws.send(JSON.stringify({ type: "bid:rejected", reason: "Bidding is not active" }));
          return;
        }

        if (!room.currentPlayer) {
          ws.send(JSON.stringify({ type: "bid:rejected", reason: "No player on the block" }));
          return;
        }

        const captain = room.captains.find((c) => c.id === captainId);
        if (!captain) {
          ws.send(JSON.stringify({ type: "bid:rejected", reason: "Captain not found" }));
          return;
        }

        const bidAmount = msg.amount;

        if (bidAmount <= room.currentHighestBid) {
          ws.send(JSON.stringify({ type: "bid:rejected", reason: `Bid must be higher than current bid of ${room.currentHighestBid}` }));
          return;
        }

        if (bidAmount < room.currentPlayer.basePrice) {
          ws.send(JSON.stringify({ type: "bid:rejected", reason: `Bid must be at least the base price of ${room.currentPlayer.basePrice}` }));
          return;
        }

        if (bidAmount > captain.balance) {
          ws.send(JSON.stringify({ type: "bid:rejected", reason: `Insufficient Riyal Coins! Your balance is ${captain.balance}` }));
          return;
        }

        // Synchronous Update
        room.currentHighestBid = bidAmount;
        room.currentHighestBidderId = captainId;
        room.status = "bidding";

        resetBidTimer(room);

        // Send confirmation to the sender
        ws.send(JSON.stringify({ type: "bid:accepted", amount: bidAmount }));

        // Broadcast updated bid info to all
        broadcastToRoom(room, {
          type: "bid:update",
          amount: room.currentHighestBid,
          bidderId: room.currentHighestBidderId,
          timerSeconds: room.timerSeconds,
        });

        // Broadcast full sync (updates currentHighestBidder styles on other clients)
        broadcastSync(room);
        return;
      }

      // Host controls
      if (role !== "host") {
        ws.send(JSON.stringify({ type: "notification", message: "Unauthorized action", isError: true }));
        return;
      }

      switch (msg.type) {
        case "auction:start":
          if (room.status === "upcoming") {
            console.log(`[Host] Starting auction room ${roomId}`);
            await putNextPlayerOnBlock(room);
          }
          break;

        case "auction:next":
          console.log(`[Host] Advancing player in room ${roomId}`);
          if (room.currentPlayer) {
            clearBidTimer(room);
            if (room.currentHighestBid > 0 && room.currentHighestBidderId) {
              // Scenario B: Force sell to current highest bidder
              console.log(`[Host] Force selling ${room.currentPlayer.name} to highest bidder`);
              await handleTimerExpiry(room);
            } else {
              // Scenario A: Player goes unsold
              console.log(`[Host] Skipping ${room.currentPlayer.name} as unsold`);
              const player = room.currentPlayer;
              player.passCount += 1;

              const MAX_PASSES = 2;
              let isSkipped = false;
              if (player.passCount >= MAX_PASSES) {
                player.status = "skipped";
                isSkipped = true;
                room.playerQueue = room.playerQueue.filter((id) => id !== player.id);
              } else {
                room.playerQueue = room.playerQueue.filter((id) => id !== player.id);
                room.playerQueue.push(player.id);
              }

              await prisma.player.update({
                where: { id: player.id },
                data: { status: player.status, passCount: player.passCount },
              });

              await prisma.auction.update({
                where: { roomCode: room.roomCode },
                data: {
                  playerQueue: JSON.stringify(room.playerQueue),
                  currentPlayerId: null,
                  currentHighestBid: 0,
                  currentHighestBidderId: null,
                },
              });

              if (isSkipped) {
                broadcastToRoom(room, { type: "player:skipped", player });
              } else {
                broadcastToRoom(room, { type: "notification", message: `${player.name} went unsold.` });
              }

              room.currentPlayer = null;
              await putNextPlayerOnBlock(room);
            }
          } else {
            // Scenario C: No current player on block, load next
            await putNextPlayerOnBlock(room);
          }
          break;

        case "auction:pause":
          if (room.status === "bidding") {
            console.log(`[Host] Paused bidding in room ${roomId}`);
            room.status = "paused";
            await prisma.auction.update({
              where: { roomCode: room.roomCode },
              data: { status: "paused" },
            });
            broadcastSync(room);
          }
          break;

        case "auction:resume":
          if (room.status === "paused") {
            console.log(`[Host] Resumed bidding in room ${roomId}`);
            room.status = "bidding";
            await prisma.auction.update({
              where: { roomCode: room.roomCode },
              data: { status: "bidding" },
            });
            resetBidTimer(room);
            broadcastSync(room);
          }
          break;

        case "auction:undo":
          if (room.lastSaleInfo) {
            const { playerId, captainId, soldPrice } = room.lastSaleInfo;
            console.log(`[Host] Undoing sale of player ${playerId} to captain ${captainId}`);

            const captain = room.captains.find((c) => c.id === captainId);
            if (captain) {
              captain.balance += soldPrice;
            }

            // Restore player database state
            await prisma.$transaction([
              prisma.captain.update({
                where: { id: captainId },
                data: { balance: { increment: soldPrice } },
              }),
              prisma.player.update({
                where: { id: playerId },
                data: {
                  status: "available",
                  soldPrice: null,
                  soldToCaptainId: null,
                },
              }),
              prisma.bidLog.deleteMany({
                where: {
                  auctionId: room.roomCode,
                  captainId,
                  playerId,
                  amount: soldPrice,
                },
              }),
            ]);

            // Add player back to the FRONT of the queue
            room.playerQueue.unshift(playerId);

            // Fetch player info to load onto block
            const dbPlayer = await prisma.player.findUnique({ where: { id: playerId } });
            if (dbPlayer) {
              room.currentPlayer = {
                id: dbPlayer.id,
                name: dbPlayer.name,
                position: dbPlayer.position,
                basePrice: dbPlayer.basePrice,
                status: "available",
                passCount: dbPlayer.passCount,
                soldPrice: null,
                soldToCaptainId: null,
              };
            }

            room.currentHighestBid = 0;
            room.currentHighestBidderId = null;
            room.status = "live";
            room.lastSaleInfo = null;

            clearBidTimer(room);

            // Checkpoint queue
            await prisma.auction.update({
              where: { roomCode: room.roomCode },
              data: {
                currentPlayerId: playerId,
                currentHighestBid: 0,
                currentHighestBidderId: null,
                playerQueue: JSON.stringify(room.playerQueue),
                status: "live",
              },
            });

            broadcastToRoom(room, { type: "notification", message: "Last sale undone. Player is back on the block." });
            broadcastSync(room);
          } else {
            ws.send(JSON.stringify({ type: "notification", message: "No sale to undo", isError: true }));
          }
          break;
      }
    },

    async close(ws, code, reason) {
      const { roomId, role, captainId } = ws.data;
      const room = activeRooms.get(roomId);
      if (!room) return;

      room.sockets.delete(ws);

      if (role === "captain" && captainId) {
        const captain = room.captains.find((c) => c.id === captainId);
        if (captain) {
          captain.isOnline = false;
          console.log(`[WS] Captain ${captain.name} disconnected (marked Away)`);
        }
      } else {
        console.log(`[WS] ${role} disconnected from ${roomId}`);
      }

      broadcastSync(room);
    },
  },
});

console.log(`[Bun WS Server] Running on ws://localhost:8080/ws (and http://localhost:8080)`);
