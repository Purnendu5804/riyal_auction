"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuctionState, PlayerData, CaptainData, ServerMessage } from "../types";
import { API_URL, WS_URL } from "../config";

interface DBPlayer {
  id: string;
  name: string;
  position: string;
  basePrice: number;
  status: string;
  passCount: number;
  soldPrice: number | null;
  soldToCaptainId: string | null;
}

function SpectatorWatch() {
  const searchParams = useSearchParams();
  const roomCode = searchParams.get("roomCode")?.toUpperCase() || "";

  const [state, setState] = useState<AuctionState | null>(null);
  const [allPlayers, setAllPlayers] = useState<DBPlayer[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastSoldEvent, setLastSoldEvent] = useState<{ player: PlayerData; captainName: string; price: number } | null>(null);
  const [lastSkippedEvent, setLastSkippedEvent] = useState<{ player: PlayerData } | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial allPlayers data from API and sync updates
  const fetchRoomData = async () => {
    try {
      const res = await fetch(`${API_URL}/api/room/${roomCode}`);
      const data = await res.json();
      if (data.success) {
        setState(data.state);
        setAllPlayers(data.allPlayers || []);
      }
    } catch (err) {
      console.error("Error fetching room details:", err);
    }
  };

  useEffect(() => {
    if (!roomCode) return;

    fetchRoomData();

    const ws = new WebSocket(`${WS_URL}/ws?roomCode=${roomCode}&role=spectator`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);

      switch (msg.type) {
        case "sync":
          setState(msg.state);
          // Refetch database state when sync happens to update rosters
          fetchRoomData();
          break;
        case "player:sold":
          const captainName = state?.captains.find(c => c.id === msg.captainId)?.name || "Captain";
          setLastSoldEvent({
            player: msg.player,
            captainName,
            price: msg.price
          });
          // Remove banner after 5 seconds
          setTimeout(() => setLastSoldEvent(null), 5000);
          fetchRoomData();
          break;
        case "player:skipped":
          setLastSkippedEvent({ player: msg.player });
          setTimeout(() => setLastSkippedEvent(null), 5000);
          fetchRoomData();
          break;
        case "timer:tick":
          setState((prev) => prev ? { ...prev, timerSeconds: msg.seconds } : null);
          break;
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [roomCode, state?.captains]);

  if (!roomCode) {
    return (
      <div style={errorPageStyle}>
        <h2>Error: Room Code is missing.</h2>
        <a href="/" className="btn-primary" style={{ marginTop: "20px" }}>Go back home</a>
      </div>
    );
  }

  if (!state) {
    return (
      <div style={errorPageStyle}>
        <div style={{ fontSize: "24px", color: "var(--accent-purple)", animation: "pulse 1.5s infinite" }}>
          Connecting to Watch Stream Room {roomCode}...
        </div>
      </div>
    );
  }

  const getCaptainName = (id: string | null) => {
    if (!id) return "None";
    return state.captains.find((c) => c.id === id)?.name || "Unknown";
  };

  // Group drafted players by captain
  const getDraftedPlayers = (captainId: string) => {
    return allPlayers.filter((p) => p.status === "sold" && p.soldToCaptainId === captainId);
  };

  return (
    <div style={containerStyle}>
      {/* Broadcast Overlay Notifications */}
      {lastSoldEvent && (
        <div style={soldOverlayStyle}>
          <div style={soldBannerStyle}>
            <div style={soldHeaderStyle}>🔨 SOLD!</div>
            <div style={soldBodyStyle}>
              <strong style={{ color: "var(--accent-cyan)" }}>{lastSoldEvent.player.name}</strong> 
              {" joined "}
              <strong style={{ color: "var(--accent-purple)" }}>{lastSoldEvent.captainName}</strong>
              {" for "}
              <span style={{ color: "var(--accent-green)", fontWeight: "800" }}>{lastSoldEvent.price} Riyal Coins</span>
            </div>
          </div>
        </div>
      )}

      {lastSkippedEvent && (
        <div style={soldOverlayStyle}>
          <div style={{ ...soldBannerStyle, borderImage: "none", borderColor: "var(--accent-red)", background: "rgba(220, 38, 38, 0.15)" }}>
            <div style={{ ...soldHeaderStyle, color: "var(--accent-red)" }}>⚠️ SKIPPED</div>
            <div style={soldBodyStyle}>
              <strong>{lastSkippedEvent.player.name}</strong> went unsold and is permanently skipped.
            </div>
          </div>
        </div>
      )}

      {/* Top Banner */}
      <header style={headerStyle}>
        <div>
          <h1 className="title-gradient" style={logoStyle}>RIYAL DRAFT LIVE</h1>
          <p style={subtitleStyle}>ROOM CODE: <span style={{ color: "var(--accent-cyan)", fontWeight: "700" }}>{roomCode}</span></p>
        </div>
        <div style={liveBadgeStyle(wsConnected)}>
          {wsConnected ? "🔴 LIVE STREAM" : "⚪ CONNECTING"}
        </div>
      </header>

      {/* Main Broadcast Grid */}
      <div style={mainGridStyle}>
        {/* Left Column: Captain 1 Squad */}
        <div className="glass" style={squadColumnStyle}>
          {state.captains[0] ? (
            <div>
              <div style={squadHeaderStyle}>
                <h2 style={captainTitleStyle}>{state.captains[0].name}</h2>
                <div style={squadBalanceStyle}>{state.captains[0].balance} Coins</div>
              </div>
              <div style={squadRosterContainer}>
                {getDraftedPlayers(state.captains[0].id).length === 0 ? (
                  <div style={emptyRosterText}>No players drafted yet.</div>
                ) : (
                  getDraftedPlayers(state.captains[0].id).map((p) => (
                    <div key={p.id} style={playerRowStyle}>
                      <span className={`badge badge-${p.position}`}>{p.position}</span>
                      <span style={squadPlayerNameStyle}>{p.name}</span>
                      <span style={squadPlayerPriceStyle}>{p.soldPrice} Coins</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div style={emptyRosterText}>Waiting for Captain 1...</div>
          )}
        </div>

        {/* Center: Live Bidding Stage */}
        <div style={stageColumnStyle}>
          <div className="glass" style={stageCardStyle}>
            {state.currentPlayer ? (
              <div style={stageDetailsStyle}>
                <span className={`badge badge-${state.currentPlayer.position}`} style={{ alignSelf: "center", fontSize: "14px", padding: "6px 16px" }}>
                  {state.currentPlayer.position}
                </span>
                
                <h2 style={stagePlayerNameStyle}>{state.currentPlayer.name}</h2>
                
                <div style={stageBasePriceStyle}>
                  Base Price: <strong>{state.currentPlayer.basePrice} Riyal Coins</strong>
                </div>

                <div style={broadcastBiddingGrid}>
                  {/* Current highest bid */}
                  <div style={broadcastBidBox}>
                    <label style={metaLabelStyle}>Current Highest Bid</label>
                    <div style={broadcastBidValue}>{state.currentHighestBid} Riyal Coins</div>
                    <div style={broadcastBidderStyle}>
                      {state.currentHighestBidderId ? (
                        <>
                          Leading Bidder: <strong style={{ color: "var(--accent-purple)" }}>{getCaptainName(state.currentHighestBidderId)}</strong>
                        </>
                      ) : (
                        "No bids placed yet"
                      )}
                    </div>
                  </div>

                  {/* Countdown Timer */}
                  <div style={broadcastTimerBox(state.timerSeconds, state.status)}>
                    <label style={metaLabelStyle}>Time Remaining</label>
                    <div style={broadcastTimerValue(state.timerSeconds, state.status)}>
                      {state.timerSeconds}s
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={emptyStageStyle}>
                {state.status === "upcoming" ? (
                  <div>
                    <h3 style={{ fontSize: "24px", marginBottom: "12px" }}>UPCOMING DRAFT</h3>
                    <p style={{ color: "var(--text-muted)" }}>Waiting for host to begin the auction session.</p>
                  </div>
                ) : state.status === "done" ? (
                  <div>
                    <h3 style={{ fontSize: "28px", color: "var(--accent-green)", marginBottom: "12px" }}>🏆 DRAFT COMPLETE</h3>
                    <p style={{ color: "var(--text-muted)" }}>All players have been drafted. Review squads on sides.</p>
                  </div>
                ) : (
                  <div>
                    <h3 style={{ fontSize: "24px", marginBottom: "12px" }}>PREPARING STAGE</h3>
                    <p style={{ color: "var(--text-muted)" }}>Waiting for next player to be put on the block...</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Captain 2 Squad */}
        <div className="glass" style={squadColumnStyle}>
          {state.captains[1] ? (
            <div>
              <div style={squadHeaderStyle}>
                <h2 style={captainTitleStyle}>{state.captains[1].name}</h2>
                <div style={squadBalanceStyle}>{state.captains[1].balance} Coins</div>
              </div>
              <div style={squadRosterContainer}>
                {getDraftedPlayers(state.captains[1].id).length === 0 ? (
                  <div style={emptyRosterText}>No players drafted yet.</div>
                ) : (
                  getDraftedPlayers(state.captains[1].id).map((p) => (
                    <div key={p.id} style={playerRowStyle}>
                      <span className={`badge badge-${p.position}`}>{p.position}</span>
                      <span style={squadPlayerNameStyle}>{p.name}</span>
                      <span style={squadPlayerPriceStyle}>{p.soldPrice} Coins</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div style={emptyRosterText}>Waiting for Captain 2...</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SpectatorWatchPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#fff" }}>Loading...</div>}>
      <SpectatorWatch />
    </Suspense>
  );
}

// Spectator console inline styling
const containerStyle: React.CSSProperties = {
  maxWidth: "1400px",
  margin: "0 auto",
  padding: "30px 20px",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "30px",
};

const logoStyle: React.CSSProperties = {
  fontSize: "2rem",
  fontWeight: "800",
  letterSpacing: "3px",
  margin: "0",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "var(--text-muted)",
};

const liveBadgeStyle = (connected: boolean): React.CSSProperties => ({
  background: connected ? "rgba(220, 38, 38, 0.15)" : "rgba(255, 255, 255, 0.05)",
  border: connected ? "1px solid rgba(220, 38, 38, 0.3)" : "1px solid rgba(255, 255, 255, 0.1)",
  color: connected ? "var(--accent-red)" : "var(--text-muted)",
  padding: "8px 16px",
  borderRadius: "8px",
  fontWeight: "700",
  fontSize: "13px",
  letterSpacing: "1px",
});

const mainGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "3fr 6fr 3fr",
  gap: "24px",
  flex: 1,
};

const squadColumnStyle: React.CSSProperties = {
  padding: "24px",
  height: "calc(100vh - 160px)",
  overflowY: "auto",
};

const squadHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: "20px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  paddingBottom: "12px",
};

const captainTitleStyle: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: "700",
};

const squadBalanceStyle: React.CSSProperties = {
  fontSize: "16px",
  color: "var(--accent-cyan)",
  fontWeight: "600",
};

const squadRosterContainer: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const emptyRosterText: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "14px",
  textAlign: "center",
  padding: "40px 0",
};

const playerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  background: "rgba(255, 255, 255, 0.02)",
  padding: "12px 14px",
  borderRadius: "8px",
  border: "1px solid rgba(255, 255, 255, 0.04)",
};

const squadPlayerNameStyle: React.CSSProperties = {
  marginLeft: "12px",
  fontWeight: "500",
  fontSize: "14px",
  flex: 1,
};

const squadPlayerPriceStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "13px",
  fontWeight: "600",
};

const stageColumnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const stageCardStyle: React.CSSProperties = {
  padding: "40px",
  flex: 1,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

const stageDetailsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "32px",
  textAlign: "center",
};

const stagePlayerNameStyle: React.CSSProperties = {
  fontSize: "3.8rem",
  fontWeight: "800",
  margin: "0",
  letterSpacing: "-1px",
};

const stageBasePriceStyle: React.CSSProperties = {
  fontSize: "18px",
  color: "var(--text-muted)",
};

const broadcastBiddingGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.8fr 1fr",
  gap: "24px",
  textAlign: "left",
  marginTop: "20px",
};

const broadcastBidBox: React.CSSProperties = {
  background: "rgba(147, 51, 234, 0.06)",
  border: "1px solid rgba(147, 51, 234, 0.15)",
  padding: "24px",
  borderRadius: "20px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

const metaLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  fontWeight: "600",
  marginBottom: "8px",
  letterSpacing: "1px",
};

const broadcastBidValue: React.CSSProperties = {
  fontSize: "2.8rem",
  fontWeight: "800",
  color: "var(--accent-purple)",
};

const broadcastBidderStyle: React.CSSProperties = {
  fontSize: "15px",
  marginTop: "8px",
  color: "var(--text-main)",
};

const broadcastTimerBox = (seconds: number, status: string): React.CSSProperties => {
  const isUrgent = seconds <= 3 && status === "bidding";
  return {
    background: isUrgent ? "rgba(220, 38, 38, 0.15)" : "rgba(255, 255, 255, 0.03)",
    border: isUrgent ? "1px solid rgba(220, 38, 38, 0.3)" : "1px solid rgba(255, 255, 255, 0.05)",
    padding: "24px",
    borderRadius: "20px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.3s ease",
    animation: isUrgent ? "pulse 1s infinite" : "none",
  };
};

const broadcastTimerValue = (seconds: number, status: string): React.CSSProperties => {
  const isUrgent = seconds <= 3 && status === "bidding";
  return {
    fontSize: "3.5rem",
    fontWeight: "800",
    color: isUrgent ? "var(--accent-red)" : "var(--text-main)",
  };
};

const emptyStageStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "80px 0",
};

const errorPageStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "20px",
};

// Overlay style for SOLD banners
const soldOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: "0",
  left: "0",
  right: "0",
  bottom: "0",
  background: "rgba(0, 0, 0, 0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  backdropFilter: "blur(8px)",
  animation: "scale-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
};

const soldBannerStyle: React.CSSProperties = {
  background: "rgba(20, 24, 33, 0.95)",
  border: "2px solid",
  borderImage: "linear-gradient(135deg, var(--accent-purple), var(--accent-cyan)) 1",
  padding: "48px",
  borderRadius: "16px",
  textAlign: "center",
  maxWidth: "600px",
  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
};

const soldHeaderStyle: React.CSSProperties = {
  fontSize: "3rem",
  fontWeight: "900",
  color: "var(--accent-green)",
  letterSpacing: "4px",
  marginBottom: "16px",
  animation: "count-pulse 1s ease-in-out infinite",
};

const soldBodyStyle: React.CSSProperties = {
  fontSize: "20px",
  lineHeight: "1.6",
  color: "var(--text-main)",
};
