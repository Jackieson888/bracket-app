"use client";

import { Box, Typography } from "@mui/material";

const SPLASH_PARTICLE_COLORS = [
  "var(--pink)",
  "var(--teal)",
  "var(--lav)",
  "var(--peach)",
];

const SPLASH_PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const seed = (i * 137) % 100;
  return {
    left: 5 + (seed % 90),
    size: 3 + (i % 3) * 2,
    color: SPLASH_PARTICLE_COLORS[i % SPLASH_PARTICLE_COLORS.length],
    duration: 5 + (i % 5),
    delay: (i * 0.6) % 6,
  };
});

export default function Home() {
  return (
    <Box className="splash-shell">
      <Box className="splash-bg-glow" />

      <Box className="splash-sun">
        <Box className="splash-sun-bars" />
      </Box>

      <Box className="splash-grid">
        <Box className="splash-grid-lines" />
        <Box className="splash-grid-fade" />
      </Box>

      <Box className="splash-scanlines" />

      {SPLASH_PARTICLES.map((p, i) => (
        <Box
          key={i}
          className="splash-particle"
          sx={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      <Box className="splash-content">
        <Box className="splash-wordmark">
          <Typography
            component="span"
            className="splash-wordmark-word"
            sx={{ color: "var(--pink)" }}
          >
            THIS
          </Typography>
          <Box className="splash-wordmark-badge">
            <Typography
              component="span"
              sx={{
                fontFamily: "var(--font-display)",
                fontSize: "15px",
                color: "#241c34",
              }}
            >
              VS
            </Typography>
          </Box>
          <Typography
            component="span"
            className="splash-wordmark-word"
            sx={{ color: "var(--teal)" }}
          >
            THAT
          </Typography>
        </Box>

        <Box className="splash-tagline">
          <Typography
            sx={{
              fontFamily: "var(--font-heading)",
              fontSize: "14px",
              letterSpacing: "3px",
              color: "var(--sub)",
            }}
          >
            PICK A SIDE. EVERY NIGHT.
          </Typography>
        </Box>

        <Box className="splash-cta-group">
          <Box
            component="a"
            href="/play"
            className="bracket-glow-pulse"
            sx={{
              display: "block",
              textDecoration: "none",
              padding: "15px 40px",
              borderRadius: "999px",
              backgroundColor: "var(--peach)",
            }}
          >
            <Typography
              sx={{
                fontFamily: "var(--font-display)",
                fontSize: "15px",
                letterSpacing: "1.5px",
                color: "#241c34",
              }}
            >
              PLAY
            </Typography>
          </Box>

          <Box
            component="a"
            href="/create"
            sx={{
              display: "block",
              textDecoration: "none",
              padding: "15px 40px",
              borderRadius: "999px",
              backgroundColor: "var(--lav)",
            }}
          >
            <Typography
              sx={{
                fontFamily: "var(--font-display)",
                fontSize: "15px",
                letterSpacing: "1.5px",
                color: "#241c34",
              }}
            >
              CREATE
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box className="splash-footer">
        <Typography
          sx={{
            fontFamily: "var(--font-mono-ui)",
            fontSize: "10px",
            letterSpacing: "2px",
            color: "var(--sub)",
          }}
        >
          V1.0 · NIGHT MODE
        </Typography>
      </Box>
    </Box>
  );
}
