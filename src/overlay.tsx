import { createRoot } from "react-dom/client";
import CaptureOverlay from "./components/CaptureOverlay";
import "./styles/globals.css";

createRoot(document.getElementById("overlay-root")!).render(<CaptureOverlay />);
