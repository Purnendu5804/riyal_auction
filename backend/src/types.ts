export interface PlayerData {
  id: string;
  name: string;
  position: string;
  basePrice: number;
  status: "available" | "sold" | "skipped";
  passCount: number;
  soldPrice: number | null;
  soldToCaptainId: string | null;
}

export interface CaptainData {
  id: string;
  name: string;
  balance: number;
  isOnline: boolean;
}

export interface AuctionState {
  roomCode: string;
  status: "upcoming" | "live" | "paused" | "done" | "bidding";
  currentPlayer: PlayerData | null;
  currentHighestBid: number;
  currentHighestBidderId: string | null;
  captains: CaptainData[];
  playerQueue: string[]; // List of remaining player IDs
  timerSeconds: number;
}

// WS messages sent by Client
export type ClientMessage =
  | { type: "bid:place"; amount: number }
  | { type: "auction:start" }
  | { type: "auction:next" }
  | { type: "auction:pause" }
  | { type: "auction:resume" }
  | { type: "auction:undo" };

// WS messages sent by Server
export type ServerMessage =
  | { type: "sync"; state: AuctionState }
  | { type: "bid:accepted"; amount: number }
  | { type: "bid:rejected"; reason: string }
  | { type: "bid:update"; amount: number; bidderId: string; timerSeconds: number }
  | { type: "player:sold"; player: PlayerData; captainId: string; price: number }
  | { type: "player:skipped"; player: PlayerData }
  | { type: "timer:tick"; seconds: number }
  | { type: "notification"; message: string; isError?: boolean };
