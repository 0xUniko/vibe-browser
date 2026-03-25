import type {
  GetStateMessage,
  SetPortMessage,
  SetStateMessage,
  StateResponse,
} from "./messages";

const toggle = document.getElementById("active-toggle") as HTMLInputElement;
const portInput = document.getElementById("port-input") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const connectionStatus = document.getElementById(
  "connection-status",
) as HTMLParagraphElement;

let latestState: StateResponse | null = null;

function updateUI(state: StateResponse): void {
  latestState = state;
  toggle.checked = state.isActive;
  portInput.value = String(state.port);
  statusText.textContent = state.isActive ? "Active" : "Inactive";

  if (state.isActive) {
    connectionStatus.textContent = state.isConnected
      ? `Connected to relay on :${state.port}`
      : "Connecting...";
    connectionStatus.className = state.isConnected
      ? "connection-status connected"
      : "connection-status connecting";
  } else {
    connectionStatus.textContent = "";
    connectionStatus.className = "connection-status";
  }
}

function refreshState(): void {
  chrome.runtime.sendMessage<GetStateMessage, StateResponse>(
    { type: "getState" },
    (response) => {
      if (response) {
        updateUI(response);
      }
    },
  );
}

// Load initial state
refreshState();

// Poll for state updates while popup is open
const pollInterval = setInterval(refreshState, 1000);

// Clean up on popup close
window.addEventListener("unload", () => {
  clearInterval(pollInterval);
});

// Handle toggle changes
toggle.addEventListener("change", () => {
  const isActive = toggle.checked;
  chrome.runtime.sendMessage<SetStateMessage, StateResponse>(
    { type: "setState", isActive },
    (response) => {
      if (response) {
        updateUI(response);
      }
    },
  );
});

function submitPort(): void {
  const port = portInput.valueAsNumber;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    portInput.reportValidity();
    if (latestState) {
      portInput.value = String(latestState.port);
    }
    return;
  }

  chrome.runtime.sendMessage<SetPortMessage, StateResponse>(
    { type: "setPort", port },
    (response) => {
      if (response) {
        updateUI(response);
      }
    },
  );
}

portInput.addEventListener("change", submitPort);
portInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  submitPort();
});
