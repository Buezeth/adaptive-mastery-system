---
unit_id: "virtual_scroll_engine"
unit_order: 1
introduces:
  - "virtual_scroll"
  - "damping_physics"
  - "wrap_boundary"
  - "scroll_state"
assumes: []
---

# virtual_scroll_engine — Virtual Scroll & Input Physics

> **Last source verification:** 2026-11-02
> **Scope mapping:** `lib/engine`

## What this helps the user do

When you visit the site, you navigate through multiple 3D scenes simply by spinning your mouse wheel, swiping on a trackpad or touchscreen, or tapping the arrow keys. Instead of native document scrolling where page elements slide off-screen, your gestures smoothly speed up and slow down an endless journey through a 3D landscape that loops seamlessly without ever hitting a page boundary.

## Why the feature needs to exist

Standard browser scrolling is designed for 2D text documents: it measures physical pixel offsets (`window.scrollY`), can jerk abruptly with free-spinning mouse wheels, and stops hard at the bottom of the page.

In a multi-scene WebGL experience, native scrolling fails for three reasons:
1. **Scene transitions need precise blending progress**, not pixel offsets.
2. **Aggressive wheel flicks would cause visual teleportation**, breaking 3D camera animations and causing rendering stutters.
3. **The experience is designed as an infinite seamless loop**, whereas standard browser documents have a fixed top and bottom.

To give the user fluid physical momentum and keep camera moves cinematic, the application disables native scroll entirely (`overflow: hidden`) and runs its own physics simulation.

## The first idea to understand

The foundational concept is **virtual scroll**: instead of moving the HTML document, every user input (wheel tick, touch drag, keyboard arrow) is converted into an abstract delta added to a continuous numerical coordinate, `y`.

To make movement feel heavy and natural, this coordinate is not changed instantly. Instead, it flows through two damping stages:
- **`targetY2` (Input Target):** Where your input is trying to go immediately.
- **`targetY1` (First Filter):** A heavily damped step with speed limits to absorb wild wheel spikes.
- **`y` (Current Visual Position):** The actual position rendered on your screen each frame.

```
wheel / touch / key
        │
        ▼
    targetY2  ────(smooth step with max speed limit)────▶  targetY1  ────(smooth catch-up)────▶  y (rendered)
```

Because `targetY2` is constrained to stay close to `y` (the rubber-band rule), spinning your wheel with extreme speed cannot teleport the camera into the future.

## Follow one real example through the system

Let's follow what happens when you flick your mouse wheel downward:

1. **Event Capture:** In [lib/engine/engine.ts:323](lib/engine/engine.ts#L323), a non-passive `wheel` event listener intercepts your gesture and cancels default browser handling with `event.preventDefault()`.
2. **Delta Scaling:** The wheel delta is multiplied by `multiplier` (`0.00075`) and added to `this.scroll.targetY2` in [lib/engine/scroll.ts:56-59](lib/engine/scroll.ts#L56-L59).
3. **Frame Simulation:** On the next animation frame, `update(ratio, now)` runs:
   - `s.targetY1` moves toward `s.targetY2` using `lerpFPSLimited`, advancing by at most `100 * multiplier` per frame.
4. **Loop Wrap & Active Sections:** `s.y` is wrapped with modulo against `s.total`. The unit interval `[n, n+1)` identifies the primary section currently on screen.
5. **Autocenter Settling:** If you stop scrolling for 1.4 seconds, `updateAutoCenter` eases `y` toward the nearest section's resting position using a GSAP tween.

## What you should now be able to reason about

- **Explain it back (`explain_back`):** Explain why two stages of damping are used instead of a single simple `lerp(current, target, 0.1)`.
