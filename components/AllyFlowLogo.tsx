"use client";

import { motion } from "framer-motion";

export default function AllyFlowLogo() {
  return (
    <motion.div
      className="w-full max-w-4xl mx-auto select-none relative"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <div className="relative">
        <svg
          viewBox="0 0 900 160"
          className="w-full h-auto"
          role="img"
          aria-label="AllyFlow"
        >
          <defs>
            <linearGradient id="logoWhite" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#FFFFFF" />
            </linearGradient>
          </defs>

          {/* Shadow base */}
          <text
            x="450" y="123"
            textAnchor="middle"
            fontFamily="inherit"
            fontWeight="400"
            fontSize="96"
            letterSpacing="12"
            fill="#FFFFFF"
            opacity={0.15}
          >
            ALLYFLOW
          </text>

          {/* Main face */}
          <text
            x="450" y="120"
            textAnchor="middle"
            fontFamily="inherit"
            fontWeight="400"
            fontSize="96"
            letterSpacing="12"
            fill="url(#logoWhite)"
          >
            ALLYFLOW
          </text>
        </svg>
      </div>
    </motion.div>
  );
}
