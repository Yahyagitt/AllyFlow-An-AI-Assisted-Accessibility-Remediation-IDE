"use client";

import { useState, useCallback, useEffect } from "react";

interface Settings {
  fontSize: number;
  wordWrap: "on" | "off";
  tabSize: 2 | 4 | 8;
  minimap: boolean;
  anonymousUsage: boolean;
}

const STORAGE_KEY = "allyflow-settings";

const DEFAULTS: Settings = {
  fontSize: 13,
  wordWrap: "on",
  tabSize: 4,
  minimap: false,
  anonymousUsage: true,
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch {
  }
  return DEFAULTS;
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateFontSize = useCallback((fontSize: number) => {
    setSettings((prev) => ({ ...prev, fontSize }));
  }, []);

  const updateWordWrap = useCallback((wordWrap: "on" | "off") => {
    setSettings((prev) => ({ ...prev, wordWrap }));
  }, []);

  const updateTabSize = useCallback((tabSize: 2 | 4 | 8) => {
    setSettings((prev) => ({ ...prev, tabSize }));
  }, []);

  const updateMinimap = useCallback((minimap: boolean) => {
    setSettings((prev) => ({ ...prev, minimap }));
  }, []);

  const updateAnonymousUsage = useCallback((anonymousUsage: boolean) => {
    setSettings((prev) => ({ ...prev, anonymousUsage }));
  }, []);

  const clearScanData = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.removeItem("allyflow-recent-scans");
      localStorage.removeItem("allyflow_scan_date");
      localStorage.removeItem("allyflow_scan_count");
    } catch {}
  }, []);

  return {
    ...settings,
    updateFontSize,
    updateWordWrap,
    updateTabSize,
    updateMinimap,
    updateAnonymousUsage,
    clearScanData,
  };
}
