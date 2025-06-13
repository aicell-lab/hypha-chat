import { useState, useEffect, useCallback, useRef } from "react";
import { useHyphaStore } from "../store/hypha";
import { IconButton } from "./button";
import UserIcon from "../icons/user.svg";
import ConnectionIcon from "../icons/connection.svg";
import { hyphaWebsocketClient } from "hypha-rpc";
import styles from "./login-button.module.scss";

interface LoginButtonProps {
  className?: string;
}

interface LoginConfig {
  server_url: string;
  login_callback: (context: { login_url: string }) => void;
}

const serverUrl = "https://hypha.aicell.io";

// Move token logic outside of component
const getSavedToken = () => {
  const token = localStorage.getItem("token");
  if (token) {
    const tokenExpiry = localStorage.getItem("tokenExpiry");
    if (tokenExpiry && new Date(tokenExpiry) > new Date()) {
      return token;
    }
  }
  return null;
};

const REDIRECT_PATH_KEY = "redirectPath"; // Define key for sessionStorage

export default function LoginButton({ className = "" }: LoginButtonProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const {
    user,
    connect,
    setUser,
    isConnecting,
    isConnected,
    disconnect,
    initializeDefaultProject,
  } = useHyphaStore();

  // Add a ref to track if auto-login has been attempted
  const autoLoginAttemptedRef = useRef(false);

  // Add click outside handler to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const dropdown = document.getElementById("user-dropdown");
      if (dropdown && !dropdown.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Add logout handler
  const handleLogout = async () => {
    try {
      await disconnect();
      setIsDropdownOpen(false);
      // Reset auto-login flag so user can login again
      autoLoginAttemptedRef.current = false;
    } catch (error) {
      console.error("Error during logout:", error);
    }
  };

  const loginCallback = (context: { login_url: string }) => {
    window.open(context.login_url);
  };

  const login = async () => {
    const config: LoginConfig = {
      server_url: serverUrl,
      login_callback: loginCallback,
    };

    try {
      // Use the login method from the client
      const token = await hyphaWebsocketClient.login(config);
      localStorage.setItem("token", token);
      localStorage.setItem(
        "tokenExpiry",
        new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      );
      return token;
    } catch (error) {
      console.error("Login failed:", error);
      return null;
    }
  };

  const performLogin = async (isAutoLogin: boolean = false) => {
    const logPrefix = isAutoLogin
      ? "[LoginButton] Auto-login"
      : "[LoginButton] Manual login";

    if (isLoggingIn || isConnecting || isConnected) {
      console.log(`${logPrefix} - Already logging in or connected, skipping`);
      return;
    }

    console.log(`${logPrefix} - Starting login process`);
    setIsLoggingIn(true);

    try {
      let token = getSavedToken();

      if (!token) {
        if (isAutoLogin) {
          console.log(`${logPrefix} - No saved token, skipping auto-login`);
          return;
        }
        token = await login();
        if (!token) {
          throw new Error("Failed to obtain token");
        }
      }

      // Small delay to ensure token is saved to localStorage
      await new Promise((resolve) => setTimeout(resolve, 10));

      await connect({
        server_url: serverUrl,
        token: token,
        method_timeout: 180000,
      });

      // Initialize default project after successful connection
      try {
        await initializeDefaultProject();
      } catch (error) {
        console.warn("Failed to initialize default project:", error);
        // Don't throw error since login was successful
      }

      if (isAutoLogin) {
        autoLoginAttemptedRef.current = true;
      }
    } catch (error) {
      console.error(`${logPrefix} - Error:`, error);
      localStorage.removeItem("token");
      localStorage.removeItem("tokenExpiry");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogin = useCallback(async () => {
    await performLogin(false);
  }, []);

  // Auto-login on component mount if token exists
  useEffect(() => {
    const autoLogin = async () => {
      // Only attempt auto-login once and only if we haven't tried before
      if (autoLoginAttemptedRef.current) {
        return;
      }

      const token = getSavedToken();
      if (token && !isConnected && !isConnecting && !isLoggingIn) {
        await performLogin(true);
      } else {
        // Mark as attempted even if we don't have a token
        autoLoginAttemptedRef.current = true;
      }
    };

    // Small delay to avoid race conditions with manual login
    const timeoutId = setTimeout(autoLogin, 100);
    return () => clearTimeout(timeoutId);
  }, []); // Empty dependency array - only run on mount

  // Debug effect to log connection state changes
  useEffect(() => {
    if (isConnected && user) {
      console.log(
        "Login successful - User:",
        user.email,
        "Connected:",
        isConnected,
      );
    }
  }, [isConnected, user]);

  return (
    <div className={className}>
      {user?.email ? (
        <div className="relative">
          <IconButton
            icon={<UserIcon />}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            title={`Logged in as ${user.email}`}
            bordered
          />

          {/* Dropdown Menu */}
          {isDropdownOpen && (
            <div
              id="user-dropdown"
              style={{
                position: "absolute",
                right: 0,
                top: "100%",
                marginTop: "8px",
                width: "192px",
                backgroundColor: "var(--white)",
                borderRadius: "8px",
                boxShadow: "var(--card-shadow)",
                padding: "4px 0",
                zIndex: 50,
                border: "var(--border-in-light)",
              }}
            >
              <div
                style={{
                  padding: "8px 16px",
                  fontSize: "14px",
                  color: "var(--black)",
                  borderBottom: "var(--border-in-light)",
                }}
              >
                {user.email}
              </div>
              <button
                onClick={handleLogout}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 16px",
                  fontSize: "14px",
                  color: "var(--black)",
                  backgroundColor: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--hover-color)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
              >
                Logout
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          title={isLoggingIn ? "Logging in..." : "Login to Hypha"}
          className={styles.loginButtonPrimary}
        >
          <ConnectionIcon style={{ width: "16px", height: "16px" }} />
          <span>{isLoggingIn ? "Logging in..." : "Login"}</span>
        </button>
      )}
    </div>
  );
}
