// Centralized configuration constants for the uTrain exercise tracker

// Classifier settings
export const K_NEIGHBORS = 5;
export const MIN_KEYPOINT_CONFIDENCE = 0.3;

// Rep counting
export const MIN_CONFIDENCE = 0.7;
export const SMOOTHING_FRAMES = 3;  // consecutive frames needed before state transition

// Auto-detection
export const DETECT_WINDOW = 15;     // frames to look back
export const DETECT_THRESHOLD = 10;  // frames needed to initially detect
export const SWITCH_THRESHOLD = 12;  // frames needed to switch (hysteresis)

// Session
export const SET_IDLE_TIMEOUT = 3000; // ms before auto-logging a set

// Visualization
export const KEYPOINT_RADIUS = 8;
export const DISPLAY_THRESHOLD = 0.5;
