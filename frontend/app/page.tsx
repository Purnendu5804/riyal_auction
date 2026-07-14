"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "./config.ts";

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"captain" | "spectator" | "host">("captain");
  
  // Form fields
  const [roomCode, setRoomCode] = useState("");
  const [captainName, setCaptainName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Host Action: Create Room
  const handleCreateRoom = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/create`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        router.push(`/host?roomCode=${data.roomCode}`);
      } else {
        setError(data.error || "Failed to create room.");
      }
    } catch (err) {
      setError("Unable to connect to the backend server. Make sure it is running.");
    } finally {
      setLoading(false);
    }
  };

  // Captain Action: Join Room
  const handleJoinAsCaptain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !captainName.trim()) {
      setError("Please fill in both the room code and your name.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: roomCode.trim().toUpperCase(),
          name: captainName.trim(),
        }),
      });
      
      const data = await res.json();
      if (data.success) {
        // Save captain identity to localStorage
        localStorage.setItem(`riyal_captain_token_${roomCode.trim().toUpperCase()}`, data.token);
        localStorage.setItem(`riyal_captain_id_${roomCode.trim().toUpperCase()}`, data.captainId);
        localStorage.setItem(`riyal_captain_name_${roomCode.trim().toUpperCase()}`, data.name);
        
        router.push(`/captain?roomCode=${roomCode.trim().toUpperCase()}`);
      } else {
        setError(data.error || "Failed to join room.");
      }
    } catch (err) {
      setError("Unable to connect to the backend server. Make sure it is running.");
    } finally {
      setLoading(false);
    }
  };

  // Spectator Action: Watch Room
  const handleWatchAuction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) {
      setError("Please enter a room code.");
      return;
    }
    router.push(`/watch?roomCode=${roomCode.trim().toUpperCase()}`);
  };

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1 className="title-gradient" style={logoStyle}>RIYAL AUCTION</h1>
        <p style={taglineStyle}>The server-authoritative live football draft platform</p>
      </header>

      <main className="glass" style={cardStyle}>
        {/* Tab switcher */}
        <div style={tabContainerStyle}>
          <button 
            style={activeTab === "captain" ? activeTabStyle : tabStyle}
            onClick={() => { setActiveTab("captain"); setError(null); }}
          >
            Captain
          </button>
          <button 
            style={activeTab === "spectator" ? activeTabStyle : tabStyle}
            onClick={() => { setActiveTab("spectator"); setError(null); }}
          >
            Spectator
          </button>
          <button 
            style={activeTab === "host" ? activeTabStyle : tabStyle}
            onClick={() => { setActiveTab("host"); setError(null); }}
          >
            Host
          </button>
        </div>

        {error && (
          <div style={errorContainerStyle}>
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Tab content */}
        {activeTab === "captain" && (
          <form onSubmit={handleJoinAsCaptain} style={formStyle}>
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Auction Room Code</label>
              <input 
                type="text" 
                placeholder="e.g. RIYAL" 
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="input-field"
                style={inputStyle}
                maxLength={10}
              />
            </div>
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Select Captain Identity</label>
              <select 
                value={captainName}
                onChange={(e) => setCaptainName(e.target.value)}
                className="input-field"
                style={{ ...inputStyle, background: "rgba(15, 23, 42, 0.8)", cursor: "pointer", color: captainName ? "var(--text-main)" : "var(--text-muted)" }}
              >
                <option value="" disabled>-- Select Your Name --</option>
                <option value="Lionel Yadav">Lionel Yadav</option>
                <option value="Cristiano Gupta">Cristiano Gupta</option>
              </select>
            </div>
            <button 
              type="submit" 
              className="btn-primary" 
              style={buttonStyle}
              disabled={loading}
            >
              {loading ? "Joining..." : "Enter Auction"}
            </button>
          </form>
        )}

        {activeTab === "spectator" && (
          <form onSubmit={handleWatchAuction} style={formStyle}>
            <div style={inputGroupStyle}>
              <label style={labelStyle}>Auction Room Code</label>
              <input 
                type="text" 
                placeholder="e.g. RIYAL" 
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="input-field"
                style={inputStyle}
                maxLength={10}
              />
            </div>
            <button 
              type="submit" 
              className="btn-primary" 
              style={buttonStyle}
            >
              Watch Live Stream
            </button>
          </form>
        )}

        {activeTab === "host" && (
          <div style={hostContainerStyle}>
            <p style={hostWarningStyle}>
              As the Host, you will manage the player block, skip players, pause bidding, and finalize transactions.
            </p>
            <button 
              onClick={handleCreateRoom} 
              className="btn-primary" 
              style={buttonStyle}
              disabled={loading}
            >
              {loading ? "Initializing..." : "Create New Auction Room"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// Inline styles for landing page
const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "20px",
  position: "relative",
  zIndex: 1,
};

const headerStyle: React.CSSProperties = {
  textAlign: "center",
  marginBottom: "30px",
  animation: "slide-in-top 0.5s ease-out",
};

const logoStyle: React.CSSProperties = {
  fontSize: "3.5rem",
  letterSpacing: "4px",
  margin: "0 0 8px 0",
};

const taglineStyle: React.CSSProperties = {
  fontSize: "1.1rem",
  color: "var(--text-muted)",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "480px",
  padding: "32px",
  animation: "scale-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
};

const tabContainerStyle: React.CSSProperties = {
  display: "flex",
  background: "rgba(0, 0, 0, 0.2)",
  borderRadius: "10px",
  padding: "4px",
  marginBottom: "24px",
};

const tabStyle: React.CSSProperties = {
  flex: 1,
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  padding: "10px",
  borderRadius: "8px",
  fontWeight: "600",
  fontSize: "14px",
  cursor: "pointer",
  transition: "all 0.2s ease",
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: "rgba(255, 255, 255, 0.08)",
  color: "var(--text-main)",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
};

const errorContainerStyle: React.CSSProperties = {
  background: "rgba(220, 38, 38, 0.15)",
  border: "1px solid rgba(220, 38, 38, 0.3)",
  color: "var(--accent-red)",
  padding: "12px",
  borderRadius: "8px",
  marginBottom: "20px",
  fontSize: "14px",
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
};

const inputGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: "600",
  color: "var(--text-muted)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  marginTop: "10px",
};

const hostContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  textAlign: "center",
};

const hostWarningStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "14px",
  lineHeight: "1.6",
};
