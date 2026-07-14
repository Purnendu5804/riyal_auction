"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AuctionState, PlayerData, CaptainData, ServerMessage } from "../types";
import { WS_URL } from "../config";

export default function CaptainDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const roomCode = searchParams.get("roomCode")?.toUpperCase() || "";

  // Local captain credentials
  const [token, setToken] = useState<string | null>(null);
  const [captainId, setCaptainId] = useState<string | null>(null);
  const [captainName, setCaptainName] = useState<string | null>(null);

  // States
  const [state, setState] = useState<AuctionState | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Custom bid field
  const [customBidAmount, setCustomBidAmount] = useState("");
  
  const wsRef = useRef<WebSocket | null>(null);

  // Load captain credentials from localStorage
  useEffect(() => {
    if (!roomCode) return;
    const storedToken = localStorage.getItem(`riyal_captain_token_${roomCode}`);
    const storedId = localStorage.getItem(`riyal_captain_id_${roomCode}`);
    const storedName = localStorage.getItem(`riyal_captain_name_${roomCode}`);

    if (!storedToken || !storedId || !storedName) {
      // Credentials not found, redirect to landing page
      router.push(`/?roomCode=${roomCode}`);
      return;
    }

    setToken(storedToken);
    setCaptainId(storedId);
    setCaptainName(storedName);
  }, [roomCode, router]);

  // Connect to WS
  useEffect(() => {
    if (!roomCode || !token) return;

    const ws = new WebSocket(`${WS_URL}/ws?roomCode=${roomCode}&role=captain&token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setErrorMessage(null);
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
        case "bid:accepted":
          setSuccessMessage(`Bid of ${msg.amount} Riyal Coins placed!`);
          setTimeout(() => setSuccessMessage(null), 3000);
          setErrorMessage(null);
          break;
        case "bid:rejected":
          setErrorMessage(msg.reason);
          setTimeout(() => setErrorMessage(null), 5000);
          break;
        case "notification":
          if (msg.isError) {
            setErrorMessage(msg.message);
            setTimeout(() => setErrorMessage(null), 5000);
          }
          break;
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      setErrorMessage("Disconnected from live auction server. Attempting reconnect...");
    };

    return () => {
      ws.close();
    };
  }, [roomCode, token]);

  const placeBid = (amount: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setErrorMessage("No connection to auction server.");
      return;
    }
    
    wsRef.current.send(JSON.stringify({ type: "bid:place", amount }));
  };

  const handleCustomBid = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(customBidAmount);
    if (isNaN(parsed) || parsed <= 0) {
      setErrorMessage("Please enter a valid bid amount.");
      return;
    }

    if (state && parsed <= state.currentHighestBid) {
      setErrorMessage(`Bid must be higher than current bid of ${state.currentHighestBid}`);
      return;
    }

    placeBid(parsed);
    setCustomBidAmount("");
  };

  if (!roomCode) {
    return (
      <div style={errorPageStyle}>
        <h2>Error: Room Code is missing.</h2>
        <a href="/" className="btn-primary" style={{ marginTop: "20px" }}>Go back home</a>
      </div>
    );
  }

  if (!state || !captainId) {
    return (
      <div style={errorPageStyle}>
        <div style={{ fontSize: "24px", color: "var(--accent-purple)", animation: "pulse 1.5s infinite" }}>
          Reconnecting to Room {roomCode}...
        </div>
      </div>
    );
  }

  // Find myself and opponent
  const myData = state.captains.find((c) => c.id === captainId);
  const opponentData = state.captains.find((c) => c.id !== captainId);

  // Check bid state
  const isLeadingBidder = state.currentHighestBidderId === captainId;
  const nextIncrement = state.currentHighestBid > 0 
    ? state.currentHighestBid + 5 
    : (state.currentPlayer?.basePrice || 5);

  const getCaptainName = (id: string | null) => {
    if (!id) return "None";
    return state.captains.find((c) => c.id === id)?.name || "Unknown";
  };

  return (
    <div style={containerStyle}>
      {/* Top Header */}
      <header style={headerStyle}>
        <div>
          <span style={connectionBadgeStyle(wsConnected)}>
            {wsConnected ? "● Online" : "● Offline/Connecting"}
          </span>
          <h1 className="title-gradient" style={titleStyle}>{myData?.name || captainName}</h1>
          <p style={subtitleStyle}>ROOM CODE: {roomCode}</p>
        </div>
        <div className="glass" style={balanceContainerStyle}>
          <label style={metaLabelStyle}>Your Balance</label>
          <div style={balanceValueStyle}>{myData?.balance ?? 0} Riyal Coins</div>
        </div>
      </header>

      {/* Notifications */}
      {errorMessage && (
        <div style={notificationStyle("error")}>
          <span>⚠️</span> {errorMessage}
        </div>
      )}
      {successMessage && (
        <div style={notificationStyle("success")}>
          <span>✅</span> {successMessage}
        </div>
      )}

      {/* Main Grid */}
      <div style={gridStyle}>
        {/* Left Card: Player bidding arena */}
        <div style={leftColStyle}>
          <div className="glass" style={playerCardStyle(isLeadingBidder)}>
            <h2 style={sectionTitleStyle}>CURRENT PLAYER ON BLOCK</h2>
            {state.currentPlayer ? (
              <div style={playerDetailsStyle}>
                <span className={`badge badge-${state.currentPlayer.position}`} style={{ alignSelf: "flex-start" }}>
                  {state.currentPlayer.position}
                </span>
                <h3 style={playerNameStyle}>{state.currentPlayer.name}</h3>
                
                <div style={playerBaseStyle}>
                  Base Price: <strong>{state.currentPlayer.basePrice} Riyal Coins</strong>
                </div>

                <div style={biddingArenaStyle}>
                  {/* Current highest bid */}
                  <div style={bidDisplayBox(isLeadingBidder)}>
                    <label style={metaLabelStyle}>Current Highest Bid</label>
                    <div style={bidValueStyle}>{state.currentHighestBid} Riyal Coins</div>
                    <span style={bidderNameStyle}>
                      Bidder: {isLeadingBidder ? "You" : getCaptainName(state.currentHighestBidderId)}
                    </span>
                  </div>

                  {/* Bid timer */}
                  <div style={timerBoxStyle(state.timerSeconds, state.status)}>
                    <label style={metaLabelStyle}>Draft Timer</label>
                    <div style={timerValueStyle}>{state.timerSeconds}s</div>
                  </div>
                </div>

                {/* Bidding Controls */}
                {state.status === "paused" ? (
                  <div style={pausedBannerStyle}>Bidding has been paused by the host.</div>
                ) : isLeadingBidder ? (
                  <div style={leadingBannerStyle}>🔥 You are the highest bidder!</div>
                ) : (
                  <div style={biddingActionsContainer}>
                    {/* Fixed Increments */}
                    <div style={incrementGrid}>
                      <button 
                        onClick={() => placeBid(nextIncrement)} 
                        className="btn-primary"
                        disabled={myData && myData.balance < nextIncrement}
                      >
                        Bid {nextIncrement} (+5)
                      </button>
                      <button 
                        onClick={() => placeBid(state.currentHighestBid + 10)} 
                        className="btn-primary"
                        disabled={myData && myData.balance < (state.currentHighestBid + 10)}
                      >
                        Bid {state.currentHighestBid + 10} (+10)
                      </button>
                      <button 
                        onClick={() => placeBid(state.currentHighestBid + 25)} 
                        className="btn-primary"
                        disabled={myData && myData.balance < (state.currentHighestBid + 25)}
                      >
                        Bid {state.currentHighestBid + 25} (+25)
                      </button>
                    </div>

                    {/* Custom Bid */}
                    <form onSubmit={handleCustomBid} style={customBidForm}>
                      <input 
                        type="number"
                        placeholder="Enter custom bid"
                        value={customBidAmount}
                        onChange={(e) => setCustomBidAmount(e.target.value)}
                        className="input-field"
                        style={{ flex: 1, minWidth: "120px" }}
                        min={nextIncrement}
                        max={myData?.balance ?? 0}
                      />
                      <button type="submit" className="btn-secondary">
                        Custom Bid
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <div style={emptyPlayerBlockStyle}>
                {state.status === "upcoming" ? (
                  <p>Draft has not started. Waiting for host to initiate.</p>
                ) : state.status === "done" ? (
                  <p>Draft completed! Check watch screen for final squads.</p>
                ) : (
                  <p>No player on the block. Waiting for host to release next player.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Card: Opponent details */}
        <div style={rightColStyle}>
          <div className="glass" style={sideCardStyle}>
            <h2 style={sectionTitleStyle}>OPPONENT TEAM</h2>
            {opponentData ? (
              <div style={opponentRowStyle}>
                <div style={opponentHeaderStyle}>
                  <div style={opponentNameContainer}>
                    <span style={onlineIndicatorStyle(opponentData.isOnline)}></span>
                    <span style={captainNameStyle}>{opponentData.name}</span>
                    {!opponentData.isOnline && <span style={awayBadgeStyle}>Away</span>}
                  </div>
                  <div style={opponentBalanceStyle}>{opponentData.balance} Riyal Coins left</div>
                </div>
              </div>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                Waiting for second captain to join...
              </div>
            )}
          </div>

          <div className="glass" style={sideCardStyle}>
            <h2 style={sectionTitleStyle}>DRAFT STATUS</h2>
            <div style={{ fontSize: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div>Draft Queue Remaining: <strong style={{ color: "var(--accent-cyan)" }}>{state.playerQueue.length}</strong></div>
              <div>State: <strong style={{ textTransform: "capitalize" }}>{state.status}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Captain dashboard inline styling
const containerStyle: React.CSSProperties = {
  maxWidth: "1000px",
  margin: "0 auto",
  padding: "40px 20px",
  minHeight: "100vh",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "32px",
};

const titleStyle: React.CSSProperties = {
  fontSize: "2.2rem",
  margin: "4px 0",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "var(--text-muted)",
};

const balanceContainerStyle: React.CSSProperties = {
  padding: "16px 24px",
  textAlign: "right",
};

const connectionBadgeStyle = (connected: boolean): React.CSSProperties => ({
  fontSize: "12px",
  fontWeight: "700",
  color: connected ? "var(--accent-green)" : "var(--accent-red)",
  textTransform: "uppercase",
  letterSpacing: "1px",
});

const metaLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  fontWeight: "600",
  marginBottom: "4px",
  display: "block",
};

const balanceValueStyle: React.CSSProperties = {
  fontSize: "1.8rem",
  fontWeight: "800",
  color: "var(--accent-cyan)",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.8fr 1fr",
  gap: "32px",
};

const leftColStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const rightColStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "32px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "13px",
  letterSpacing: "1.5px",
  color: "var(--text-muted)",
  marginBottom: "20px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  paddingBottom: "10px",
  fontWeight: "700",
  textTransform: "uppercase",
};

const playerCardStyle = (leading: boolean): React.CSSProperties => ({
  padding: "32px",
  flex: 1,
  borderWidth: leading ? "1px" : "1px",
  borderColor: leading ? "var(--accent-purple)" : "var(--border-glass)",
  boxShadow: leading ? "var(--shadow-neon-purple)" : "none",
});

const playerDetailsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const playerNameStyle: React.CSSProperties = {
  fontSize: "2.8rem",
  fontWeight: "800",
  margin: "0",
};

const playerBaseStyle: React.CSSProperties = {
  fontSize: "16px",
  color: "var(--text-muted)",
};

const biddingArenaStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2fr 1fr",
  gap: "20px",
  alignItems: "stretch",
};

const bidDisplayBox = (leading: boolean): React.CSSProperties => ({
  background: leading ? "rgba(34, 197, 94, 0.08)" : "rgba(255, 255, 255, 0.03)",
  border: leading ? "1px solid rgba(34, 197, 94, 0.2)" : "1px solid rgba(255, 255, 255, 0.05)",
  padding: "20px",
  borderRadius: "16px",
  display: "flex",
  flexDirection: "column",
});

const bidValueStyle: React.CSSProperties = {
  fontSize: "2.2rem",
  fontWeight: "800",
  color: "var(--text-main)",
  margin: "8px 0 4px 0",
};

const bidderNameStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: "600",
  color: "var(--text-muted)",
};

const timerBoxStyle = (seconds: number, status: string): React.CSSProperties => {
  const isUrgent = seconds <= 3 && status === "bidding";
  return {
    background: isUrgent ? "rgba(220, 38, 38, 0.15)" : "rgba(255, 255, 255, 0.03)",
    border: isUrgent ? "1px solid rgba(220, 38, 38, 0.3)" : "1px solid rgba(255, 255, 255, 0.05)",
    padding: "20px",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  };
};

const timerValueStyle: React.CSSProperties = {
  fontSize: "2.5rem",
  fontWeight: "800",
  lineHeight: "1",
};

const pausedBannerStyle: React.CSSProperties = {
  padding: "16px",
  background: "rgba(234, 179, 8, 0.15)",
  border: "1px solid rgba(234, 179, 8, 0.3)",
  color: "var(--accent-yellow)",
  borderRadius: "12px",
  textAlign: "center",
  fontWeight: "700",
  fontSize: "16px",
};

const leadingBannerStyle: React.CSSProperties = {
  padding: "16px",
  background: "rgba(34, 197, 94, 0.15)",
  border: "1px solid rgba(34, 197, 94, 0.3)",
  color: "var(--accent-green)",
  borderRadius: "12px",
  textAlign: "center",
  fontWeight: "700",
  fontSize: "16px",
  animation: "pulse 2s infinite",
};

const biddingActionsContainer: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
};

const incrementGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: "12px",
};

const customBidForm: React.CSSProperties = {
  display: "flex",
  gap: "12px",
};

const emptyPlayerBlockStyle: React.CSSProperties = {
  padding: "60px 20px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: "16px",
};

const sideCardStyle: React.CSSProperties = {
  padding: "24px",
};

const opponentRowStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.03)",
  padding: "16px",
  borderRadius: "12px",
  border: "1px solid rgba(255, 255, 255, 0.05)",
};

const opponentHeaderStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const opponentNameContainer: React.CSSProperties = {
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

const opponentBalanceStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "var(--accent-cyan)",
  fontWeight: "600",
};

const notificationStyle = (type: "error" | "success"): React.CSSProperties => {
  const isErr = type === "error";
  return {
    background: isErr ? "rgba(220, 38, 38, 0.15)" : "rgba(34, 197, 94, 0.15)",
    border: isErr ? "1px solid rgba(220, 38, 38, 0.3)" : "1px solid rgba(34, 197, 94, 0.3)",
    color: isErr ? "var(--accent-red)" : "var(--accent-green)",
    padding: "12px 16px",
    borderRadius: "12px",
    marginBottom: "24px",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
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
