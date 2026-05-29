"use client";

import { useState, useCallback, useEffect } from "react";

interface Settings {
  fontSize: number;
  wordWrap: "on" | "off";
}

const STORAGE_KEY = "allyflow-settings";

const DEFAULTS: Settings = {
  fontSize: 13,
  wordWrap: "on",
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

  return {
    ...settings,
    updateFontSize,
    updateWordWrap,
  };
}
