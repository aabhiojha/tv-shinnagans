// Edit, then ./deploy.sh. Every key is optional.
var CONFIG = {
  name: '',                 // "Good evening, <name>"
  columns: 6,               // app grid columns
  dockSize: 5,              // apps in the dock
  dockDefaults: ['Netflix', 'YouTube', 'Prime Video', 'Spotify'], // first-run dock, by name
  inputNames: { 'HDMI 1': 'TV' }, // connected HDMI ports get a dock tile; name them here, others show as "HDMI 2"
  prefer: { YouTube: 'TizenTube' }, // show the better app under the stock app's name, and hide the stock one
  background: '#000000',
  glow: true,               // ambient glow in the focused app's colour
  screensaverMinutes: 5     // 0 turns the clock screensaver off
};
