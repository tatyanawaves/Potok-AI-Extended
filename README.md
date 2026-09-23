<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ODisxldLkQddIlUhXkHtTuvtH_epl_x_

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Universe viewer

`npm run dev`, then open `/universe.html`: a procedural universe in three.js, separate from the main app.

- **Cosmic web**: galaxies on the surface of the Mandelbulb (the 3D Mandelbrot set). A galaxy's type comes from its escape time in the 2D set.
- **Galaxy**: an exponential disk with logarithmic arms, a Kroupa IMF, and blackbody star colours. Differential rotation follows a flat rotation curve, and dark matter can be switched off.
- **Star system**: the real Solar System (JPL J2000 elements, positions for today's date) or a system generated from the orbit z → z² + c. Spacing is kept Hill-stable. The scale is set so that the 78 million km between Earth and Mars take 30 s (or 90 s) to fly. Controls: autopilot, free flight, Kepler's 2nd law, and the gravity well.
- **Black hole**: per-pixel null geodesics in Schwarzschild spacetime and a Shakura–Sunyaev disk with Doppler beaming. An optional loop-quantum-gravity core shows the singularity replaced by flat quanta of space; this part is speculative.
