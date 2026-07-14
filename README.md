# CaptchaOS

A fake little operating system that runs in your browser and refuses to believe you're human.

It looks like Windows 98 decided to have a cozy night. The old gray look is gone, replaced with a dark sky, a glowing moon, rain on the window, and a warm little vibe. Then it spends the whole time making you prove you're not a robot. You log in by solving CAPTCHAs. You search the web, and it throws another CAPTCHA at you before showing the results. You open the Control Panel, and it won't let you change anything until you verify yourself. There's also a potato named Spud sitting on the taskbar, drinking coffee, roasting you, and somehow trusting you even less than the system does.

None of it is useful. That's the whole point.

## Running It

It's just static files. No build step, no `npm install`, and nothing to compile.

* Double-click `index.html`, or
* Serve the folder with `python3 -m http.server`, then open the address it gives you.

Using a local server is recommended because some browsers can be picky with audio and fonts when using `file://`, but both methods work. The only thing loaded from the internet is a few pixel fonts from Google Fonts. Everything else, including the sounds, is generated on the fly.

It's best experienced on a desktop with a mouse. A lot of the jokes are made with your mouse in mind.

## What Happens

You start with a fake boot screen, complete with a loading bar and some questionable status messages like *"Calibrating trust levels: LOW."* After that comes the login, where instead of entering a password, you have to survive a series of CAPTCHAs before the desktop finally lets you in.

Once you're in, you'll find a normal-looking desktop with icons, windows, and a Start menu. You can drag the windows around and stack a few at once, but only three. Try to open a fourth and CaptchaOS panics at you with a pile of error boxes, because of course it does.

* **Cozle Browser** — Search anything you want. Click a result, and it decides that looks suspicious, so you have to solve another CAPTCHA first.
* **CAPTCHA Trials** — Take on a series of CAPTCHAs that keep getting weirder and harder the further you go.
* **Snake** — A playable snake game. Things start getting a little strange the longer you survive.
* **Notepad, Control Panel, Recycle Bin** — They're mostly there to give you something to click... before the system finds a reason to stop you.

The CAPTCHAs are the best part. There's the classic *"I'm not a robot"* checkbox that takes way too long to decide, an emoji grid where you're asked to *"select all existential dread,"* a tiny pixel street where you have to find the traffic light, and a mechanical puzzle where you remove bolts with the arrow keys. One of the bolts is reverse-threaded, because of course it is.

I won't spoil how the Trials end. Just know there's an ending, and it's not a graceful one.

## Spud

There's a potato on the taskbar. His name is Spud.

He sits there with a cup of coffee, blinks, takes the occasional sip, and acts like he doesn't care. Click on him and he'll say something. Sometimes he's friendly, sometimes he roasts you, and sometimes he just says complete nonsense until his coffee runs out. He also pays attention. He notices when you stop moving, counts your clicks, remembers when you fail CAPTCHAs or lose at Snake, and always has something sarcastic to say about it.

As Spud gets more suspicious, his eyes start following your cursor around. He never gets dramatic about it. The little guy stays cozy, keeps sipping his coffee, and quietly judges every move you make. He'll also roast you when you fail a CAPTCHA or lose at Snake, just to remind you he was watching.

## The Cozy Part

Under all the paranoia, it's actually meant to be a cozy little place to hang out.

The desktop is set at night, with a glowing moon, twinkling stars, the odd shooting star, drifting clouds, gentle rain, and a warm lamp glowing in the corner. A soft CRT effect sits over the screen, and a real clock keeps ticking away in the taskbar.

All the audio is generated live using the Web Audio API, so there are no sound files anywhere in the project. That includes a slow lo-fi background loop that plays while you're active. Stop moving for a while and the music fades out, like the OS thinks you've disappeared. Leave it long enough and it gets worried. The whole screen goes dark for an **Alive Test**: a giant Spud looms in and watches while you move your cursor in a circle, wiggle it around, or click along to a beat, and a little meter reads your "liveliness." Nothing else is clickable until you pass. Do it, and the music comes back.

## Poking Around

If you just want to explore without going through the whole boot process, there are a few handy query parameters. They also get printed to the browser console when the page loads.

* `?go=desktop` — Skip the boot screen and login.
* `?cap=traffic` *(also `grid`, `checkbox`, `text`, `mechanical`)* — Open a specific CAPTCHA.
* `?q=cats` — Open the browser with a search already loaded.
* `?snake=2` — Start Snake a couple of levels in.
* `?spud=3` — Make Spud fully paranoid right away.
* `?audiocheck=1` — Trigger the Alive Test takeover.
* `?finale=1` — Jump straight to the ending (you've been warned).

## How It's Built

It's all plain HTML, CSS, and JavaScript. No frameworks, no bundlers, and no build step. If your browser can open it, you're ready to go.

```
index.html        the page; loads everything
css/os.css        all the styling and the pixel art
js/
  os.js           boot, login, desktop, wiring
  wm.js           window manager: dragging, the error popups
  captcha.js      every captcha type lives here
  gauntlet.js     chains captchas together
  browser.js      Cozle Browser
  snake.js        the game
  audio.js        all sound, synthesized
  presence.js     the mouse-watching + the Audio Activity Check
  spud.js         the potato
  finale.js       the ending
```

Each script attaches a small object to `window` (`WM`, `Captcha`, `Sound`, `Spud`, and a few others), and they all talk to each other directly. It's old-school on purpose, so you can open any file and read it from top to bottom without digging through imports.

One thing to keep in mind if you edit the project: every `<link>` and `<script>` tag in `index.html` has a `?v=N` at the end to avoid browser caching. If you change a file, bump that number too, or you might end up debugging an old cached version instead of your latest changes.

## Known Issues

It's just a fun little project, so there are a few things to keep in mind:

* It's made for desktops with a mouse. Touch devices and small screens aren't fully supported.
* The pixel fonts need an internet connection the first time they're loaded.
* Snake has a half-finished anti-cheat system that still needs some work.

If something breaks, refreshing the page usually fixes it. If it doesn't... it might just be part of the experience.

---

Best enjoyed at night with a warm drink nearby.

And whatever you do, don't trust the potato.