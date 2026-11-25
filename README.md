KEYSCAPE revisions and writeups

changes and fixes:
 - 3dp frame, with hanging capability and power cable routing, and maybe a pane of protection plexiglass. Put title of work and URL link text on the frame itself so it cannot be seperated.
 - Kiosk mode - should be 'android installable' progressive web app so it can be configured for kiosk mode on our target device
 - "Internet is down, please tell to local human authority" indicator in the HUD when keys stop being able to be checked
 - figure out what to do with http://petroff.ryan.gitlab.io/ethkeyscape/ and https://gitlab.com/petroff.ryan/ethkeyscape
 - hierarchical keys starting from seed phrase and checking top ten keys in each derivation path on every available blockchain and L2, with corresponding rotating hilbert cube for each (maybe consider other shapes later) ( inspo https://seedgen.uk/ )
 - if too much info to hold in 1 line on the screen, make bottom text a scrolling marquee
 - make a diagram for the writeup, like web2toweb3 got
 - inject a 'hit' test key every n days, like once every few days or something, to make sure everything is working
 - find places that will agree to hang it
 - find a hosting service other than github? 
 - confirm emailed blobs can actually be decrypted lolol
 - publish artists statement to futures.love ,  and give keyscape.futures.love to the project
 - optional mode: labelled cubes, where the labels fade in for a few seconds per minute.
 - optional mode: when gallery mode is enabled, remove the colour option toggles
 - Write out an explanation for using github as hosting, link to the no-crypto-no-llm policies of sr.ht and codeberg
 - document and try to back up the state of the target device, like having to use Chrome://flags enabled advanced features, power and sleep and backlight and colour temp settings etc 
 - mobile/web mode has some HUD issues with elements getting stacked up and overlapping. Desktop vs mobile mode is completely uninvestigated.
 - occasionally display some explanatory text? or some cryptic bullshit? Make more use of the HUD to keep things fresh on the order of ten minutes
 - superscript characters failing to display, might as well be 2^n form for legibility
 - vanity address search! and use that as the heartbeat report every... 48h?
  copypasted from project readme on github
 - have the project rewritten in a human-comprehensible way, with full front/back seperation, ready to be used as a literate programming textbook chapter. Record a video of yourself teaching from it to confirm it makes sense.
 - note how gitlab gives you troubles, like random rate-limiting you from viewing your code on the public gitlab website frontend
 - dedicated power supply and thin plug cable suited to the target device (5v 3a?)
Some TODOs and things to verify:
 - does it work on any device when static-hosted on github-pages? YES IT WORKS!
 - does it work on our target device? KIND OF! only the light-mode colours are legible. needs work.
 - does it download keys it finds in a way that survives a power failure?
 - will a Toronto gallery pay me to hang it? Allow me to hang it?
 - Currently hosted at ~~https://ryanfutures.github.io/keyscape/~~ - add a cool domain like keyscape.futures.love maybe? --> https://keyscape.futures.love/ working!
 - Wants to be independently reviewed by a technologist, an artist, and a normie.
 - Missing a cool favicon?
 - Make sure no public-facing prose on the page is not handwritten. Don't forcefeed anyone slop!
 - make a video comparison of V1 to this implementation
 - get all the TODOs out of your discord chat from when you prompted up this slop
 - try installing chrome on the target device? try einkbro too. Need to see console.log outputs
 - document the settings and state of the target device
 - legibility testing
 - add an explainer or readme link to the frontend, people are confused what it is
 - 3d print a frame for the target device to be hung on the wall in
more notes even more wow
 - Maybe this is a chance to 3dp the frame from something strong like metal? good excuse to use jlcpcb cnc or metal 3dp
 - Show it to Omar! and ask about your lucifer and statement placard 
 - maybe bring in a sculpture artist for the frame design? lots of digital cubes and keys and stuff like that, in an ornate style, could be a cool collab opportunity. Maybe ask the internet for toronto sculptors specifically?
 - subdomain keyscpe.futures.love ! and maybe print that on the work's frame - success for https://keyscape.futures.love
 - maybe adding a swarm of orbiting cubes of a different fractal type for all the eth L2s, and keeping this piece eth, and making a seperate one with the whole hierarchical key supermultichain thing
 - yeah, have the known-hot key injected at 48h intervals and have the emails deliver a bunch of data, like runtime and keys checked and of course the encrypted known-hot key that went through the full path like a random key.
 - scannable QR on the frame next to the URL so people can take the piece with them in their pocket! and follow something something
 - start clean with rules for what the LLM should not do, like write prose or comments
 - is ~10^77 correct, and is that how we want to write that size? shouldnt it be 2^? because it's bits?
 - separation of concerns even more. Some text for the frontend is in html, some is in js . Clean and refine.


KEYSCAPE by Ryan Futures

“When we hold our own keys, None can expel us from paradise.”
( explain this quote is from you, based on math history. explain the concept of mathematical elegance too ) 

This project has been brewing for many years, so it touches a lot of stories.



Notes:
Used CNCKitchen's bumpmesh.com
Used Claude with my good friend E (Thanks!) and fed it my v1 ethkeyscape
Using github as hosting service for the code and github pages for static hosting the website
Using many free blockchain api services to check keys
Using web3forms for heartbeat communications back to me from running installations 
Using a BOOX noteair5c from a friend that had an ai psychosis cult of sorts. Tell that story in a footnote maybe.
Include the photos taken of each prototype print
Find historical photos of the apartment you worked on v1 on ipads, maybe show some screenshots. Maybe maybe include a boot-up animation that shows the evolution of the hilbert curves from nothing to a line to a cube etc big nice fade-in animation that plays every hour. spawning cubes out of a black hole in a cool mist or nebula would rule. throw in some quazars sheeeeeeiiiiiit
What are some other cool fractal curves? Each chain can maybe have a different shape. hilbert sphere....? serpinski pyramid (for Less!) all the platonic solids, really, right? 
Let the audience know that while the code may be slop, all prose here is human authored.
Mandelbulb... is cool.... does it make sense here? What is the central shape that gives the top-level key?
Map keys to the space of complex numbers somehow?
https://en.wikipedia.org/wiki/List_of_fractals has three nice cube variants to start 3D Hilbert curve3D Lebesgue curve 3D Lebesgue curve
Sierpinski Diamond (octahedron) 

Plan an article structure? Let's try:
First, show the thing
-Very high level why, beauty and elegance and truth and goodness, philosophy - try to keep it short, collapsible. All portions collapsible.
-What is it?
-Why was it made?
-Who, When, Where
-How
