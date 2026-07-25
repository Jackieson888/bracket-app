"use client";

import { motion, AnimatePresence } from "framer-motion";

export function RoundTransition({ round, children }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={round}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.98 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        style={{ width: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
