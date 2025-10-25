# Sound Effects Download Guide

## Quick Links to Free Sound Libraries

### Freesound.org (Requires free account)
Visit https://freesound.org and search for:

1. **select-shell.mp3** - Search: "metal click" or "gun reload"
2. **select-grenade.mp3** - Search: "grenade pin" or "metal clink"
3. **select-spread.mp3** - Search: "shotgun pump" or "shotgun reload"
4. **select-bomber.mp3** - Search: "air raid siren short" or "alarm warning"
5. **select-nuke.mp3** - Search: "nuclear siren" or "emergency alarm"
6. **select-homing.mp3** - Search: "missile lock" or "beep radar"

7. **fire-shell.mp3** - Search: "cannon shot" or "artillery fire"
8. **fire-grenade.mp3** - Search: "grenade launcher" or "thump launch"
9. **fire-spread.mp3** - Search: "shotgun blast"
10. **fire-bomber.mp3** - Search: "airplane propeller" or "bomber engine"
11. **fire-nuke.mp3** - Search: "rocket launch" or "missile whoosh"
12. **fire-homing.mp3** - Search: "missile launch small"

13. **explode-small.mp3** - Search: "explosion small" or "impact blast"
14. **explode-medium.mp3** - Search: "explosion medium" or "grenade explosion"
15. **explode-large.mp3** - Search: "explosion large" or "bomb blast"
16. **explode-huge.mp3** - Search: "explosion huge" or "nuclear blast"

17. **shield-on.mp3** - Search: "energy shield" or "force field activate"
18. **shield-hit.mp3** - Search: "shield impact" or "energy deflect"

### Pixabay Sound Effects
Visit https://pixabay.com/sound-effects/search/

- Filter by: "Short" duration (under 10 seconds)
- License: All are free for commercial use
- Download as MP3

### OpenGameArt.org
Visit https://opengameart.org/art-search-advanced

- Type: Audio
- License: CC0 or CC-BY 3.0
- Tags: "explosion", "weapon", "military"

## Quick Test

After downloading, you can test in the browser console:
```javascript
const audio = new Audio('assets/audio/explode-huge.mp3');
audio.play();
```

## Tips

1. Keep files under 100KB for fast loading
2. Use MP3 format for best browser compatibility
3. Normalize volume levels so all sounds are consistent
4. Trim silence from beginning/end of files
5. You can use Audacity (free) to edit and export sounds

## Optional: Generate Placeholder Sounds

If you want to test the system before downloading real sounds, you can use the Web Audio API to generate simple beep sounds (but real sound effects are much better!).
