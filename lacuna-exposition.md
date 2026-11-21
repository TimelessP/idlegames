# Lacuna: Gaps, Loops and Resonance

### An exposition of a game designed for a mind that finds gaps, lives in many dimensions, and returns

*Companion paper to `lacuna.html` · November 2026*

---

## Abstract

*Lacuna* is an endless, single-file browser game about noticing absence. Each level presents a real mathematical object (a polygon, a lattice, a tesseract, a torus knot, a bundle of linked Hopf circles) embedded in anywhere from two to seven dimensions and projected as a slowly turning shadow. Something about the object is wrong. A point is missing, a point does not belong, or a point keeps the wrong time. The player's task is to find the gap.

On top of this core sits a second, slower loop: every completed constellation becomes a *memory* that fades along an exponential forgetting curve and must be revisited at well-spaced intervals to grow stronger. A third layer, a dynamical system of coupled oscillators, turns the act of repair into audible and visible synchrony.

This paper sets out the design premise, explains each mechanic and the science (or lore) it draws on, gives the actual equations and parameters the game uses, and is candid about where the game simplifies, borrows loosely, or leans on ideas whose evidence is contested.

---

## 1. Premise: designing for a particular kind of mind

The brief was unusual. It was not "make a puzzle game" but *make a game for someone who loves, experiences many dimensions, is good at finding gaps, and has loops that let them revisit thoughts over different time intervals*. That sentence became the specification, one clause at a time:

| Trait in the brief | Design response |
|---|---|
| **Good at finding gaps** | The core verb is *noticing absence*: three distinct kinds of gap, each engaging a different perceptual faculty (spatial closure, pattern rejection, rhythm). |
| **Experiences many dimensions** | Objects genuinely live in 2–7 dimensions. The player rotates through hidden axes, and depth is rendered as colour, a deliberate cross-modal mapping. |
| **Has loops; revisits thoughts over time** | The Loop Garden: real wall-clock forgetting curves, and spaced revisitation that strengthens memories the way spaced practice strengthens human recall. |
| **Loves** | The reward state is *synchrony*: lights that were pulsing independently fall into step when the structure is made whole. Mended gaps are rendered in gold, permanently (after *kintsugi*). |
| **Endless, not shallow** | Procedural generation over 20 structure families, adaptive difficulty that tracks the player's edge, and a memory system that gives returning a purpose. |

The aim was a game whose difficulty comes from *perception and inference*, not reflexes or memorised trivia, and whose long-term structure rewards the rhythm of leaving and coming back.

---

## 2. The core act: three kinds of absence

### 2.1 The missing light (◌): Gestalt closure

Most levels hide one or more points of the structure. The threads (edges) that *would* connect to a missing point are simply absent, so the player sees a lattice with a hole, a hypercube with a vertex nobody occupies, a curve with a break in it.

This draws directly on **Gestalt closure**, the well-documented tendency of perception to complete incomplete figures. In Kanizsa's illusory triangle, people see bright contours that are printed nowhere; the visual system supplies them. Lacuna asks the player to make that completion *conscious*: to locate the place their mind already expects something to be, and touch it.

Three design details keep this from being trivial:

1. **The target moves.** The structure rotates continuously, so the missing point's projected position drifts. The player must infer the *rule* of the shape, not memorise a pixel.
2. **Gaps are never adjacent.** The generator refuses to remove two neighbouring points, so every missing point is surrounded by enough visible structure to be deducible.
3. **Names never lie.** Each constellation receives a procedurally generated poetic name, *The Folded Loom of Sixteen Bells*, whose number is the true count of points in the complete structure. A player who counts what is visible against what is promised has an honest, quiet clue.

### 2.2 The intruder (✕): apophenia

From the fifth constellation onward, some levels contain a point that does not belong. It is placed in the structure's interior, at least a minimum distance from every true point, and given two *fake* edges to its nearest neighbours so that it superficially resembles the pattern.

This is the shadow side of closure. **Apophenia** is the tendency to perceive meaningful pattern in noise: faces in clouds, conspiracies in coincidence. The intruder asks the player to *reject* a completion the mind wants to accept. Its tells are structural: the wrong number of connections, a position that breaks the symmetry, a trajectory under rotation that does not move "with" the rest.

### 2.3 The light out of time (∿): synchrony

Every point is an oscillator. From the tenth constellation onward, one point may be **decoupled**: it ignores its neighbours and flashes roughly 1.6 times as fast. The player must find the light that is out of step. This moves gap-finding from *space* into *time*, where the gap is rhythmic rather than geometric.

---

## 3. Moving through dimensions

### 3.1 The geometry is real

The structures are not decorative. The generator library includes:

- **2D:** regular polygons, star polygons {n/k}, rectangular and hexagonal lattices, concentric rings
- **3D:** cubic lattices, Fibonacci spheres, a double helix, the torus
- **4D:** the tesseract, the 16-cell, the 5-cell, the **24-cell**, Clifford tori, duoprisms, (p,q) torus knots, and **Hopf fibrations**
- **5D–7D:** hypercubes, orthoplexes, simplices, demicubes, *cube × polygon* product spaces, the **3-torus**, and Lissajous curves through all available dimensions

Each structure is built in its intrinsic dimension, given a random orthonormal rotation into the play dimension *D*, centred, and normalised to unit radius. Edges are either the structure's true adjacency (hypercube edges join vertices differing in one coordinate; 24-cell edges join vertices at distance √2) or, for point clouds like the Fibonacci sphere, the four nearest neighbours.

The Hopf fibration deserves a note. Its points are generated as

$$
\big(\cos\eta\cos t,\ \cos\eta\sin t,\ \sin\eta\cos(t+\delta),\ \sin\eta\sin(t+\delta)\big), \qquad t \in [0, 2\pi)
$$

For fixed (η, δ) this traces one great circle on the 3-sphere, and each choice of (η, δ) gives a distinct fibre. Any two such fibres are linked exactly once. The player rotating this object in 4D is handling an actual piece of topology.

### 3.2 Rotation

Orientation is a *D × D* orthonormal matrix **R**. Each frame, small Givens rotations are applied in two or three randomly chosen coordinate planes, with angular speeds that breathe slowly over time. At least one plane always mixes a screen axis with a hidden one, so the shadow continually reveals new aspects. Gram–Schmidt re-orthonormalisation every 90 frames keeps numerical drift from shearing the object.

The player intervenes by dragging. A horizontal drag rotates in the plane (x, *k*) and a vertical drag in (y, *k*), where *k* is the hidden axis selected at bottom-left (z, w, v, u or t). In 2D, dragging around the centre spins the plane. Freezing the drift (`F`) gives stillness when certainty is needed.

### 3.3 Projection: nested perspective

Higher dimensions are collapsed by repeated perspective division, from the highest axis down to the third:

$$
f_d = \frac{1}{1 - c\,y_d}, \qquad c = \frac{0.32}{\sqrt{D-2}}, \qquad y_q \leftarrow f_d\,y_q \ \ \text{for } q < d
$$

applied for *d* = *D*−1 down to 2. The product of the factors sets each point's apparent size and brightness: nearer in *any* hidden dimension means larger and brighter. The constant *c* shrinks with *D* so that seven nested perspectives do not explode the image.

### 3.4 Colour as an extra sense

Hue encodes depth along hidden axes:

- **3D:** hue follows the z coordinate.
- **4D and above:** hue follows the *angle* in the (z, w) plane, so colour wheels continuously as points rotate through the fourth dimension. A fifth coordinate adds a slight tint.

The palette runs gold → rose → violet → blue → teal (hue = 42° − 250°·t). This is a deliberate nod to **Charles Howard Hinton**, who in the 1880s designed sets of coloured cubes to train people to perceive four dimensions, and who coined the word *tesseract*. In Lacuna, colour is the prosthetic sense for axes the eye cannot see.

### 3.5 Listening: sonified absence

Holding `Space` (or the ear button) makes every unresolved anomaly emit a tone:

- **Pitch** encodes height on screen: *f* = 180 · 2^(2.6·(1 − y/H)) Hz, spanning about 2.6 octaves.
- **Stereo pan** encodes horizontal position.
- **Intruders** tremble with a 7 Hz tremolo; **dissonant lights** pulse audibly at their own wrong rhythm.

With headphones, a player can locate a missing point with eyes closed. The cost is gentle: the next find earns half insight, but listening never costs clarity. This is the game's most literal gesture toward synaesthesia, and its most generous accessibility feature.

---

## 4. Resonance: the dynamical layer

### 4.1 The Kuramoto model

Every visible point is an oscillator with phase θᵢ and natural frequency ωᵢ ≈ 2π · (1 ± 0.07) rad/s, close to one flash per second, a resting heartbeat. Phases evolve under the **Kuramoto model** restricted to the structure's graph:

$$
\dot\theta_i = \omega_i + \frac{K}{\deg(i)} \sum_{j \in N(i)} \sin(\theta_j - \theta_i)
$$

Yoshiki Kuramoto showed in 1975 that a population of oscillators with differing natural rhythms abruptly synchronises once coupling *K* crosses a threshold. The same mathematics describes fireflies flashing in unison, Huygens' pendulum clocks falling into opposition on a shared beam, and cardiac pacemaker cells.

### 4.2 Repair raises coupling

Coupling is tied to progress:

$$
K_{\text{target}} = K_0 + 2.0 \cdot \frac{\text{resolved}}{\text{total}}, \qquad K_0 = 0.3 \ \ (\text{or } 2.6 \text{ when a dissonant light is present})
$$

rising to *K* = 7 on completion. In ordinary levels the lights begin loosely incoherent and drift toward unison as gaps are mended. In levels with a dissonant light, the healthy lights start already synchronised so the outlier is visible against them.

When a gap is filled, the new point's phase is set to the circular mean of its neighbours: it arrives already belonging.

### 4.3 Coherence you can see and hear

The **order parameter**

$$
r\,e^{i\psi} = \frac{1}{n}\sum_j e^{i\theta_j}
$$

measures collective synchrony (0 = scattered, 1 = unison). It drives:

- the **coherence dial** at the bottom of the screen (arc length = *r*, orbiting dot = mean phase ψ);
- the **brightness of edges**, which glow when both endpoints flash together. This is a visual Hebbian rule: *cells that fire together wire together*;
- the **cutoff of the ambient drone's low-pass filter**, which opens as coherence rises (320 + 1500·r² Hz);
- a soft **heartbeat** sound, two low thumps, whenever the mean phase wraps through zero while *r* > 0.72.

Each light's visible pulse is ((1 + cos θ)/2)⁴, a sharp, firefly-like flash. All flash rates stay under 3 Hz, below the range of most concern for photosensitivity, and a reduced-motion setting softens them further.

The emotional design is simple: *wholeness sounds like a heartbeat in unison.* This is where the brief's "love" lives. Hyperscanning studies find coordinated neural rhythms between people in conversation and between parents and infants. Connection is, in part, being in phase.

---

## 5. Loops: the memory system

### 5.1 The forgetting curve

Every completed constellation is planted in the **Loop Garden** as a memory with a *stability* S (in minutes, starting at 20) and a timestamp of last contact. Its retention decays exponentially in real wall-clock time:

$$
R(t) = e^{-\Delta t / S}
$$

This is a simplified form of the curve Hermann Ebbinghaus measured on himself in 1885: steep early loss, then a long tail. A memory **calls** when *R* < 0.75, which happens at Δt ≈ 0.288·S. A fresh memory therefore first calls after about six minutes.

### 5.2 Spaced revisitation

Revisiting a memory replays the *same structure* (same seed, same shape, same name) with *different absences*, a new rotation and current difficulty. On success, stability grows:

$$
S \leftarrow S \cdot \max\!\Big(1.1,\ g\cdot(1 - 0.15\,\min(m,3))\Big), \qquad
g = \begin{cases} 1.15 & R > 0.9 \ \text{(too soon)} \\ 2 + 1.6\,(1 - R) & \text{otherwise} \end{cases}
$$

where *m* is the number of misses. Two principles from memory research are encoded here:

- **The spacing effect.** One of psychology's most replicated findings is that material revisited at widening intervals is retained far longer than the same effort massed together. A revisit made while retention is still high barely helps (×1.15); one made as the memory fades helps most (up to ×3.6).
- **Desirable difficulty.** Recall that takes effort strengthens memory more than easy recall. A spacing bonus of 40·D·(1 − R) + 10 insight rewards answering faded calls.

The resulting intervals grow roughly geometrically, from minutes to hours to days to weeks. A failed revisit halves stability (minimum 20 minutes): the memory loosened and will call again sooner.

### 5.3 Reconsolidation

Why does a revisit show the same shape with *different* gaps? Because of **reconsolidation**: recalling a memory can make it briefly malleable before it is stored again. You never return to quite the same thought. The constellation keeps its identity but is re-encountered from a new angle.

### 5.4 Echoes and open loops

If a player's clarity runs out, the constellation dissolves and is planted as an **echo**: a hollow, grey, dashed ring in the garden that calls immediately and indefinitely. Closing an echo grants a large bonus (60·D) and converts it into a living memory.

This borrows from the **Zeigarnik effect**: Bluma Zeigarnik's 1927 report that interrupted tasks are remembered better than completed ones. The evidence here is honestly *mixed*; replications have been inconsistent, and the in-game Codex labels it **contested**. But the felt pull of an unfinished thing is familiar, and the game uses it gently rather than coercively. Echoes wait without nagging, decaying, or expiring.

### 5.5 The shape of the garden

The garden is drawn as an orbital system around a glowing core (the self), whose size grows with total *resonance*:

$$
\text{resonance} = \sum_{\text{memories}} R \cdot \big(1 + \log_2(S/20)\big)
$$

- **Orbital radius** shrinks as stability grows (log-scaled), so well-loved memories are drawn *inward*.
- **Orbital speed** follows Kepler's third law in spirit: angular velocity ∝ (r_min / r)^1.5, so inner memories circle faster. The Codex's Kepler entry points this out.
- **Brightness** tracks retention. Calling memories glow rose and pulse.
- Each memory is drawn as a **miniature live rendering** of its own structure, rotating slowly through its own dimensions.

Resonance feeds back into the rest of the game: the ambient drone gains up to three additional harmonic voices as resonance grows, and the starfield behind every constellation becomes denser. A well-tended garden literally makes the world richer to look at and listen to.

Returning after six or more hours triggers a dawn message ("You were away for 9h. 4 memories are calling") and unlocks the Codex entry on **sleep replay**: during sleep, the hippocampus replays the day's activity patterns, and memories consolidate.

---

## 6. Flow: adaptive difficulty

Mihaly Csikszentmihalyi described **flow** as deep absorption arising when challenge and skill rise together. Too easy produces boredom; too hard produces anxiety. Lacuna maintains a hidden difficulty scalar *d* ∈ [0, 1.25] and adjusts it after every journey constellation:

| Outcome | Δd |
|---|---|
| No misses, under 18 s per anomaly | +0.055 |
| No misses, slower | +0.03 |
| One miss | 0 |
| *m* ≥ 2 misses | −0.05·(m − 1) |
| Over 50 s per anomaly | −0.04 additional |
| Used listening | −0.02 additional |
| Dissolved | −0.10 |

Difficulty shapes the next constellation: the number of gaps (*k* = 1 + ⌊3d + 1.3u⌋ for random *u*), the chance of intruders and dissonant lights, positional jitter (up to ~0.026 of unit radius, which blurs the perfect symmetry), and drift speed.

Two rhythmic perturbations keep the curve from feeling mechanical:

- **Breathers** (14% of levels) halve the difficulty: a rest that still counts.
- **Peaks** (10%) add +0.3: a summit worth remembering. This is a small nod to Kahneman's **peak–end rule**, which says experiences are remembered largely by their most intense moment and their ending.

Generator selection avoids the four most recently seen families, and structures whose intrinsic dimension is lower than the play dimension are down-weighted, so novelty is preserved without randomness feeling arbitrary.

### 6.1 Progression

| Dimension | Unlocked after |
|---|---|
| 2D | start |
| 3D | 2 constellations |
| 4D | 6 |
| 5D | 13 |
| 6D | 22 |
| 7D | 34 |

Intruders appear from the 5th constellation, dissonant lights from the 10th. Each newly opened dimension is introduced with its signature object: the tesseract for 4D, the 5-demicube for 5D, the 3-torus for 6D, the 7-orthoplex for 7D. Play then draws from the newest dimension and the two below it.

### 6.2 Clarity, streaks and gentleness

- **Clarity** (● ● ●, or four pips at 5D and above) is lost on a miss. At zero, the constellation dissolves into an echo. There is no game over, only an open loop.
- **Streaks** of consecutive finds without a miss raise the insight multiplier: 1 + 0.1·min(streak, 20), up to ×3.
- **Insight** per find is 10·D·multiplier, so higher dimensions are worth proportionally more. Completion adds 25·D, doubled for a flawless run.
- **Gentle mode** removes clarity entirely. Nothing is lost on a miss.
- **Intuition**: after 70 seconds without progress, faint dashed threads periodically reach partway from a missing point's neighbours toward the empty place. It is a hint that arrives the way insight does, unbidden, after the mind has been allowed to wander. (Forty-five seconds without any input unlocks the Codex entry on the **default mode network**, the brain system active during mind-wandering.)

Misses themselves are framed as information rather than failure. The first one unlocks the Codex entry on **prediction error**: in predictive-processing models of the brain, learning happens most where expectation and reality disagree.

---

## 7. Aesthetics

### 7.1 Visual

- **Ink-dark field** with soft nebular gradients and a sparse starfield.
- **Additive light**: points are pre-rendered radial-gradient sprites composited with additive blending, so overlapping lights bloom rather than occlude.
- **Motion trails**: the background is redrawn at partial opacity each frame, leaving faint luminous wakes as points move through hidden dimensions (disabled in reduced-motion mode).
- **Kintsugi**: every repaired gap, and every attuned light, is rendered in gold, along with the threads connecting to it. The completed constellation carries a permanent record of where it was broken. This is the Japanese tradition of mending pottery with gold lacquer, honouring the break rather than hiding it.
- **Typography** pairs a humanist serif (italic for names and poetry) with a wide-tracked monospace for data, a quiet contrast between the lyrical and the measured.

### 7.2 Sound

All tones are generated live with the Web Audio API. Nothing is sampled.

- **Pentatonic bells.** Every melodic event draws from a G major pentatonic scale rooted at 196 Hz. Pentatonic scales contain no semitone clashes, so any combination of finds, in any order, sounds consonant. Bells are built from inharmonic partials (ratios 1, 2, 2.76, 5.4) with exponential decay, passed through a synthesised convolution reverb.
- **The drone.** Detuned sine and triangle voices on G and D, each with slow independent vibrato, filtered by coherence and gaining harmonics with resonance.
- **A miss** is a falling low thud with a slightly sour interval: felt, not punishing.
- **An intruder released** shatters into a scatter of quick high bells.
- **Completion** is a rising six-note arpeggio over a sustained pad.

---

## 8. The Codex: honest about its sources

Thirty-six fragments are found during play, each triggered by a meaningful event: the first gap closed, the first 4D object, the first intruder, two finds within 1.5 seconds (*synchronicity*), a ten-find streak (*Hebb's rule*), a return after sleep, the fiftieth constellation (*Ouroboros*).

Each fragment is **labelled for what it is**:

| Label | Meaning | Examples |
|---|---|---|
| `science` | Well-established findings | Gestalt closure, the spacing effect, Kuramoto synchronisation, persistent homology, the curse of dimensionality, Johnson–Lindenstrauss |
| `contested` | Real research with mixed replication | the Zeigarnik effect |
| `lore` | Pseudoscience, myth and esoterica, named as such | the Theosophists' seven planes, Jung's synchronicity, the Pythagorean tetractys, Kepler's music of the spheres |
| `culture` | Aesthetic and philosophical traditions | kintsugi, *ma* (間) |
| `history` / `literature` / `philosophy` | Context and ideas | Hinton's cubes, *Flatland*, Carse's infinite games, Hofstadter's strange loops |

The brief invited "even the pseudo sciences, such as psychology". The game takes that invitation playfully but does not blur the line. Lore is welcome because it is beautiful and because it is often where real ideas were first dreamed. The seventh-dimension unlock fragment, for instance, says plainly that there is no evidence for the Theosophists' seven planes, and then observes that coincidence is a kind of rhyme.

---

## 9. Why it is endless, and why that is the point

James Carse distinguished **finite games**, played in order to win, from **infinite games**, played so that the play can go on. Lacuna is built as the second kind:

- **Procedural depth.** Twenty structure families × random parameters × random embeddings × six play dimensions × random gaps, intruders and rhythms. Revisits of the *same* memory produce genuinely different puzzles.
- **A horizon that keeps receding.** Difficulty adapts upward indefinitely toward the player's edge, and seven dimensions are deep enough that full intuition never quite arrives.
- **A reason to leave and a reason to return.** The garden's real-time clock means the game rewards *not* playing for a while, then coming back. Sessions are naturally bounded by what is calling; longer absences are welcomed, not punished.
- **Nothing is lost.** No lives, no game over, no expiry. Echoes wait. Memories fade but never vanish.

A strange loop, in Hofstadter's sense, is a system that climbs through levels and finds itself back where it started, changed. A garden of revisited thoughts is a small one.

---

## 10. Limitations and honest caveats

- **This is not cognitive training.** The game borrows mechanisms from memory and perception research for their *feel*, not to make any claim about improving memory, attention or intelligence. No such claims are made or implied.
- **The memory model is simplified.** A single exponential with a multiplicative stability update is a cartoon of models like SM-2 or FSRS. The parameters were chosen for pleasing game rhythm, not fitted to data.
- **The flow controller is heuristic.** It uses only time-per-anomaly, misses and hint use. It does not model fatigue, mood or learning curves per structure family.
- **Projection is lossy by nature.** Some configurations at some rotations are genuinely ambiguous: a missing point can project directly behind a visible one. The game is generous (a touch within range of the true projection counts), and rotation always resolves ambiguity eventually, but frozen-frame puzzles are not guaranteed to have a unique answer.
- **Hit tolerance trades precision for comfort.** The touch radius is about 4% of the shorter screen dimension (clamped 18–34 px, ×1.3 on touch screens), scaled slightly by perspective depth.
- **Persistence is local.** Progress lives in the browser's `localStorage`. Clearing site data, or opening the file in a private window, starts fresh. There is no cloud sync.
- **Colour carries information.** Players with some forms of colour-vision deficiency will lose part of the depth cue. Point size, brightness, motion and sound all carry overlapping information, but colour is not fully redundant.

---

## Appendix A: Controls

| Action | Mouse / keyboard | Touch |
|---|---|---|
| Touch a gap / intruder / dissonant light | click | tap |
| Rotate | drag | drag |
| Choose hidden axis | axis buttons, `Q` / `E`, `[` / `]`, mouse wheel | axis buttons |
| Listen | hold `Space` | hold the ear button |
| Freeze drift | `F` | ✳ button |
| Loop Garden | `G` | ◎ button |
| Continue | `Enter` | tap |
| Menu / back | `Esc` | ≡ button |

## Appendix B: Key parameters

| Parameter | Value |
|---|---|
| Oscillator natural frequency | 1 Hz ± 7% (2π·(1 ± 0.07) rad/s) |
| Dissonant frequency | 1.55–1.67 Hz, uncoupled |
| Coupling *K* | 0.3 (2.6 with dissonant) + 2.0·progress; 7 on completion |
| Heartbeat threshold | *r* > 0.72 at mean-phase wrap |
| Perspective constant | *c* = 0.32 / √(D − 2) |
| Initial memory stability | 20 minutes |
| Calling threshold | *R* < 0.75 (≈ 0.288·S after last contact) |
| Review gain | ×1.15 if R > 0.9; else ×(2 + 1.6(1 − R)), less 15% per miss (max 3), floor ×1.1 |
| Failed review | S ← max(20 min, S/2) |
| Clarity | 3 pips (4 at D ≥ 5) |
| Streak multiplier | 1 + 0.1·min(streak, 20) |
| Difficulty range | 0 – 1.25 |
| Memory cap | 320 (weakest pruned first) |
| Musical root | G3, 196 Hz, major pentatonic |

## Appendix C: Further reading

- Abbott, E. A. (1884). *Flatland: A Romance of Many Dimensions.*
- Carse, J. P. (1986). *Finite and Infinite Games.*
- Csikszentmihalyi, M. (1990). *Flow: The Psychology of Optimal Experience.*
- Ebbinghaus, H. (1885). *Über das Gedächtnis* (*Memory: A Contribution to Experimental Psychology*).
- Hinton, C. H. (1904). *The Fourth Dimension.*
- Hofstadter, D. R. (2007). *I Am a Strange Loop.*
- Kuramoto, Y. (1975). Self-entrainment of a population of coupled non-linear oscillators. *International Symposium on Mathematical Problems in Theoretical Physics*, Lecture Notes in Physics 39.
- Strogatz, S. (2003). *Sync: The Emerging Science of Spontaneous Order.*
- Wertheimer, M. (1923). Untersuchungen zur Lehre von der Gestalt II. *Psychologische Forschung*, 4.

---

*What is missing has a shape.*
