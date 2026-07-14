"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { AuctionState, PlayerData, CaptainData, ServerMessage } from "../types";
import { WS_URL } from "../config";

export default function HostConsole() {
  const searchParams = useSearchParams();
  const roomCode = searchParams.get("roomCode")?.toUpperCase() || "";

  const [state, setState] = useState<AuctionState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roomCode) return;

    // Connect to WebSocket server
    const ws = new WebSocket(`${WS_URL}/ws?roomCode=${roomCode}&role=host`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      addLog("System: Connected to live auction server.");
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      
      switch (msg.type) {
        case "sync":
          setState(msg.state);
          break;
        case "timer:tick":
          setState((prev) => prev ? { ...prev, timerSeconds: msg.seconds } : null);
          break;
        case "notification":
          addLog(`Server: ${msg.message}`);
          break;
        case "player:sold":
          addLog(`System: ${msg.player.name} sold to Captain for ${msg.price} Riyal Coins!`);
          break;
        case "player:skipped":
          addLog(`System: ${msg.player.name} has been skipped.`);
          break;
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      addLog("System: Disconnected from auction server. Trying to reconnect...");
    };

    return () => {
      ws.close();
    };
  }, [roomCode]);

  const addLog = (message: string) => {
    setLogs((prev) => [message, ...prev.slice(0, 19)]);
  };

  const sendAction = (type: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type }));
      addLog(`Action: Sent ${type}`);
    } else {
      addLog("Error: WebSocket is not connected.");
    }
  };

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
          Loading Host Dashboard for Room {roomCode}...
        </div>
      </div>
    );
  }

  const getCaptainName = (id: string | null) => {
    if (!id) return "None";
    return state.captains.find((c) => c.id === id)?.name || "Unknown";
  };

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <span style={connectionBadgeStyle(wsConnected)}>
            {wsConnected ? "● Live Connected" : "● Offline"}
          </span>
          <h1 className="title-gradient" style={titleStyle}>Host Control Room</h1>
          <p style={subtitleStyle}>ROOM CODE: <strong style={{ color: "var(--accent-cyan)", fontSize: "20px" }}>{roomCode}</strong></p>
        </div>
        <div style={statusBannerStyle(state.status)}>
          AUCTION STATUS: {state.status.toUpperCase()}
        </div>
      </header>

      <div style={gridStyle}>
        {/* Left column: Controls & Current Player */}
        <div style={leftColStyle}>
          {/* Current player on block card */}
          <div className="glass" style={playerCardStyle}>
            <h2 style={sectionTitleStyle}>PLAYER ON THE BLOCK</h2>
            {state.currentPlayer ? (
              <div style={playerDetailsStyle}>
                <span className={`badge badge-${state.currentPlayer.position}`} style={{ alignSelf: "flex-start" }}>
                  {state.currentPlayer.position}
                </span>
                <h3 style={playerNameStyle}>{state.currentPlayer.name}</h3>
                <div style={playerMetaGrid}>
                  <div>
                    <label style={metaLabelStyle}>Base Price</label>
                    <div style={metaValueStyle}>{state.currentPlayer.basePrice} Riyal Coins</div>
                  </div>
                  <div>
                    <label style={metaLabelStyle}>Pass Count</label>
                    <div style={metaValueStyle}>{state.currentPlayer.passCount} / 2 passes</div>
                  </div>
                </div>

                <div style={biddingAreaStyle}>
                  <div style={bidDisplayBox}>
                    <label style={metaLabelStyle}>Current Bid</label>
                    <div style={bidValueStyle}>{state.currentHighestBid} Riyal Coins</div>
                    <span style={bidderNameStyle}>Bidder: {getCaptainName(state.currentHighestBidderId)}</span>
                  </div>

                  <div style={timerBoxStyle(state.timerSeconds)}>
                    <label style={metaLabelStyle}>Bidding Timer</label>
                    <div style={timerValueStyle}>{state.timerSeconds}s</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={emptyPlayerBlockStyle}>
                {state.status === "upcoming" ? (
                  <p>Auction has not started yet.</p>
                ) : state.status === "done" ? (
                  <p>Auction completed! All players have been drafted.</p>
                ) : (
                  <p>No player on the block. Ready for next player.</p>
                )}
              </div>
            )}
          </div>

          {/* Action buttons panel */}
          <div className="glass" style={controlPanelStyle}>
            <h2 style={sectionTitleStyle}>HOST CONTROLS</h2>
            <div style={controlButtonsGrid}>
              {state.status === "upcoming" && (
                <button onClick={() => sendAction("auction:start")} className="btn-primary" style={{ gridColumn: "1 / -1" }}>
                  🚀 Start Auction
                </button>
              )}
              
              {state.status !== "upcoming" && state.status !== "done" && (
                <>
                  <button onClick={() => sendAction("auction:next")} className="btn-secondary" style={actionBtnStyle}>
                    ⏭️ Put Next Player / Skip
                  </button>
                  
                  {state.status === "bidding" ? (
                    <button onClick={() => sendAction("auction:pause")} className="btn-secondary" style={{ ...actionBtnStyle, borderColor: "var(--accent-yellow)" }}>
                      ⏸️ Pause Bidding
                    </button>
                  ) : state.status === "paused" ? (
                    <button onClick={() => sendAction("auction:resume")} className="btn-secondary" style={{ ...actionBtnStyle, borderColor: "var(--accent-green)" }}>
                      ▶️ Resume Bidding
                    </button>
                  ) : (
                    <button disabled className="btn-secondary" style={{ ...actionBtnStyle, opacity: 0.5 }}>
                      ⏸️ Pause Bidding
                    </button>
                  )}

                  <button onClick={() => sendAction("auction:undo")} className="btn-secondary" style={{ ...actionBtnStyle, color: "var(--accent-red)", borderColor: "rgba(220, 38, 38, 0.2)" }}>
                    ↩️ Undo Last Sale
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Captains, Queue & Live logs */}
        <div style={rightColStyle}>
          {/* Captains overview */}
          <div className="glass" style={sideCardStyle}>
            <h2 style={sectionTitleStyle}>CAPTAINS (MAX 2)</h2>
            <div style={captainsListStyle}>
              {state.captains.length === 0 ? (
                <div style={emptyCaptainsStyle}>No captains joined yet. Share the code!</div>
              ) : (
                state.captains.map((c) => (
                  <div key={c.id} style={captainRowStyle}>
                    <div>
                      <div style={captainNameContainer}>
                        <span style={onlineIndicatorStyle(c.isOnline)}></span>
                        <span style={captainNameStyle}>{c.name}</span>
                        {!c.isOnline && <span style={awayBadgeStyle}>Away</span>}
                      </div>
                      <div style={captainBalanceStyle}>{c.balance} Riyal Coins</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Queue progress */}
          <div className="glass" style={sideCardStyle}>
            <h2 style={sectionTitleStyle}>DRAFT QUEUE PROGRESS</h2>
            <div style={queueProgressStyle}>
              <div style={queueSummaryStyle}>
                <div>Remaining Players: <strong style={{ color: "var(--accent-cyan)" }}>{state.playerQueue.length}</strong></div>
              </div>
              <div style={progressBarContainerStyle}>
                <div style={progressBarFillStyle(state.playerQueue.length)} />
              </div>
            </div>
          </div>

          {/* Live system logs */}
          <div className="glass" style={logsCardStyle}>
            <h2 style={sectionTitleStyle}>LIVE ACTIVITY LOGS</h2>
            <div style={logContainerStyle}>
              {logs.map((log, index) => (
                <div key={index} style={logLineStyle(log)}>
                  {log}
                </div>
              ))}
              {logs.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: "14px" }}>Waiting for actions...</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Host Console inline styling
const containerStyle: React.CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
  padding: "40px 20px",
  minHeight: "100vh",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "32px",
  flexWrap: "wrap",
  gap: "20px",
};

const titleStyle: React.CSSProperties = {
  fontSize: "2.2rem",
  margin: "4px 0",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "var(--text-muted)",
};

const connectionBadgeStyle = (connected: boolean): React.CSSProperties => ({
  fontSize: "12px",
  fontWeight: "700",
  color: connected ? "var(--accent-green)" : "var(--accent-red)",
  textTransform: "uppercase",
  letterSpacing: "1px",
});

const statusBannerStyle = (status: string): React.CSSProperties => {
  let bg = "rgba(255, 255, 255, 0.05)";
  let color = "var(--text-muted)";
  
  if (status === "live" || status === "bidding") {
    bg = "rgba(147, 51, 234, 0.15)";
    color = "var(--accent-purple)";
  } else if (status === "paused") {
    bg = "rgba(234, 179, 8, 0.15)";
    color = "var(--accent-yellow)";
  } else if (status === "done") {
    bg = "rgba(34, 197, 94, 0.15)";
    color = "var(--accent-green)";
  }

  return {
    padding: "8px 16px",
    borderRadius: "8px",
    background: bg,
    border: `1px solid ${color}40`,
    color: color,
    fontWeight: "700",
    fontSize: "14px",
    letterSpacing: "1px",
  };
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "7fr 5fr",
  gap: "32px",
};

const leftColStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "32px",
};

const rightColStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "32px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "14px",
  letterSpacing: "1.5px",
  color: "var(--text-muted)",
  marginBottom: "20px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  paddingBottom: "10px",
  fontWeight: "700",
  textTransform: "uppercase",
};

const playerCardStyle: React.CSSProperties = {
  padding: "32px",
  flex: 1,
};

const playerDetailsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const playerNameStyle: React.CSSProperties = {
  fontSize: "2.5rem",
  fontWeight: "800",
  margin: "0",
};

const playerMetaGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "20px",
  background: "rgba(0, 0, 0, 0.15)",
  padding: "16px",
  borderRadius: "12px",
};

const metaLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  fontWeight: "600",
  marginBottom: "4px",
  display: "block",
};

const metaValueStyle: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: "700",
};

const biddingAreaStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2fr 1fr",
  gap: "20px",
  alignItems: "stretch",
};

const bidDisplayBox: React.CSSProperties = {
  background: "rgba(147, 51, 234, 0.08)",
  border: "1px solid rgba(147, 51, 234, 0.2)",
  padding: "20px",
  borderRadius: "16px",
  display: "flex",
  flexDirection: "column",
};

const bidValueStyle: React.CSSProperties = {
  fontSize: "2.2rem",
  fontWeight: "800",
  color: "var(--accent-purple)",
  margin: "8px 0 4px 0",
};

const bidderNameStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: "600",
  color: "var(--text-main)",
};

const timerBoxStyle = (seconds: number): React.CSSProperties => {
  const isUrgent = seconds <= 3;
  return {
    background: isUrgent ? "rgba(220, 38, 38, 0.15)" : "rgba(255, 255, 255, 0.03)",
    border: isUrgent ? "1px solid rgba(220, 38, 38, 0.3)" : "1px solid rgba(255, 255, 255, 0.05)",
    padding: "20px",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.3s ease",
  };
};

const timerValueStyle: React.CSSProperties = {
  fontSize: "2.5rem",
  fontWeight: "800",
  lineHeight: "1",
  margin: "4px 0 0 0",
};

const emptyPlayerBlockStyle: React.CSSProperties = {
  padding: "60px 20px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: "16px",
};

const controlPanelStyle: React.CSSProperties = {
  padding: "32px",
};

const controlButtonsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "16px",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "16px",
  fontSize: "14px",
};

const sideCardStyle: React.CSSProperties = {
  padding: "24px",
};

const captainsListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const emptyCaptainsStyle: React.CSSProperties = {
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: "14px",
  padding: "20px 0",
};

const captainRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "rgba(255, 255, 255, 0.03)",
  padding: "16px",
  borderRadius: "12px",
  border: "1px solid rgba(255, 255, 255, 0.05)",
};

const captainNameContainer: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const onlineIndicatorStyle = (online: boolean): React.CSSProperties => ({
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: online ? "var(--accent-green)" : "var(--text-muted)",
  display: "inline-block",
});

const captainNameStyle: React.CSSProperties = {
  fontWeight: "600",
  fontSize: "16px",
};

const awayBadgeStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.08)",
  color: "var(--text-muted)",
  fontSize: "10px",
  padding: "2px 6px",
  borderRadius: "4px",
  fontWeight: "700",
};

const captainBalanceStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "var(--accent-cyan)",
  fontWeight: "600",
  marginTop: "4px",
};

const queueProgressStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const queueSummaryStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "14px",
};

const progressBarContainerStyle: React.CSSProperties = {
  height: "8px",
  background: "rgba(0, 0, 0, 0.2)",
  borderRadius: "9999px",
  overflow: "hidden",
};

const progressBarFillStyle = (remaining: number): React.CSSProperties => {
  const total = 15; // seeded total players
  const percentage = Math.max(0, Math.min(100, (remaining / total) * 100));
  return {
    height: "100%",
    width: `${percentage}%`,
    background: "linear-gradient(90deg, var(--accent-purple), var(--accent-cyan))",
    borderRadius: "9999px",
    transition: "width 0.5s ease-out",
  };
};

const logsCardStyle: React.CSSProperties = {
  ...sideCardStyle,
  flex: 1,
};

const logContainerStyle: React.CSSProperties = {
  maxHeight: "220px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  paddingRight: "8px",
};

const logLineStyle = (log: string): React.CSSProperties => {
  let color = "var(--text-muted)";
  if (log.startsWith("Error:")) color = "var(--accent-red)";
  else if (log.startsWith("Action:")) color = "var(--accent-cyan)";
  else if (log.includes("sold")) color = "var(--accent-green)";

  return {
    fontSize: "13px",
    fontFamily: "monospace",
    padding: "6px 8px",
    background: "rgba(0, 0, 0, 0.15)",
    borderRadius: "6px",
    color: color,
  };
};

const errorPageStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "20px",
};
