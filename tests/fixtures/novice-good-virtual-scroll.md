---
unit_id: "virtual_scroll_engine"
unit_order: 1
introduces:
  - "virtual_scroll"
  - "damping_physics"
  - "wrap_boundary"
  - "scroll_state"
assumes: []
terms:
  - "virtual scrolling :: moving through the site with a position the site keeps track of itself, instead of the web page's built-in scrolling"
  - "damping :: smoothing that makes movement speed up and slow down gradually instead of jumping"
  - "rubber band limit :: a rule that stops the position you ask for from getting too far ahead of the position you see"
---

# virtual_scroll_engine — How the site turns your gestures into smooth travel

> **Last source verification:** 2026-11-02
> **Scope mapping:** `lib/engine`

## What this helps the user do

When you visit the site, you travel through several 3D places. You spin the mouse wheel, swipe, or press the arrow keys. The page does not slide upward like a normal web page. Instead, your gestures speed you up and slow you down on a journey that loops. After the last place, you glide straight back to the first one, and you never hit a bottom edge.

## Why the feature needs to exist

A normal web page works like a long paper scroll. You move down it, and it ends at the bottom. That does not suit this site, for three reasons.

1. The site needs to know how far you are between two places, such as "40 percent of the way". A count of pixels moved does not tell it that.
2. A fast flick of a free-spinning mouse wheel can make a normal page jump a long way at once. Here, that would make the 3D picture jerk and stutter.
3. The journey is a loop with no end, but a normal page always has a top and a bottom.

So the site switches off the built-in scrolling and runs its own.

## The first idea to understand

Imagine pulling a heavy shopping cart with a stretchy cord. Your hand moves first, and the cart follows a moment later. If you yank hard, the cord only stretches so far, so the cart cannot leap to where your hand is. It just speeds up and glides.

The site treats your scrolling the same way. This idea is called **virtual scrolling**. The site keeps its own number for how far along the journey you are, and every wheel tick, swipe, or key press nudges that number.

Two rules make the movement feel like a heavy cart instead of a twitchy page.

- **Damping** means the position you see catches up gradually, so motion eases in and out instead of jumping.
- The **rubber band limit** means the position you ask for can never get far ahead of the position you see.

Three positions are in play. For now we will give them plain names.

- The wish position is where your gesture is trying to take you.
- The cushioned position is a slower, smoothed copy of the wish.
- The screen position is what you actually see, and it follows the cushioned position.

## Follow one real example through the system

Say you flick the mouse wheel once, hard. The numbers below are made up to show the shape of what happens. The real code uses other values.

1. Before the flick, all three positions are at 0.
2. The flick sets the wish position to 10, because that is where the gesture points.
3. The rubber band limit allows the wish to be at most 4 ahead of the screen position, so the wish is pulled back to 4.
4. On the first tick of the clock, the cushioned position takes a small step toward the wish, from 0 to 1. The screen position moves part of the way toward the cushioned one, from 0 to 0.2.
5. On the next ticks, the cushioned position keeps stepping toward the wish, and the screen position keeps catching up. The motion slows down on its own as the gap closes.
6. When you stop, the three positions meet at 4, and the picture stops moving.

If you then wait about a second and a half, the site also nudges you to the nearest resting spot between two places, so you never stop half-way. The next section shows where each of these steps lives in the code.

## How the implementation makes it happen

Now that the picture is clear, here are the real names. Each plain name from the last section matches one name in the code.

| Plain name | Name in the code | Where |
|---|---|---|
| wish position | `targetY2` | lib/engine/scroll.ts |
| cushioned position | `targetY1` | lib/engine/scroll.ts |
| screen position | `y` | lib/engine/scroll.ts |

## Technical reference

Entry points and constants live here.
