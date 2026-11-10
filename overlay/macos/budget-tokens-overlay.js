// budget-tokens : overlay macOS (JavaScript for Automation, fourni avec macOS)
//
// Affiche la même barre que le mod budget-tokens dans Claude Code, au-dessus de
// la fenêtre de Claude Desktop, seulement quand elle est au premier plan. La
// ligne est calculée par le mod, qui l'écrit dans son fichier sous
// ~/.claude/plugins/store/ ; l'overlay ne fait que la dessiner.
//
// Glisser pour déplacer (la position est retenue), clic droit > Quitter.
//
//   /usr/bin/osascript -l JavaScript budget-tokens-overlay.js

ObjC.import('Cocoa')

const fm = $.NSFileManager.defaultManager
const env = $.NSProcessInfo.processInfo.environment
const home = ObjC.unwrap($.NSHomeDirectory())
const configDir = ObjC.unwrap(env.objectForKey('CLAUDE_CONFIG_DIR')) || home + '/.claude'
const storeDir = configDir + '/plugins/store'
const supportDir = home + '/Library/Application Support/budget-tokens'
const positionFile = supportDir + '/position.json'
const ownPid = $.NSProcessInfo.processInfo.processIdentifier
// Au-delà, le mod ne tourne plus : aucune session Code n'est ouverte.
const SILENT_AFTER_MS = 120000
const FOCUS_S = 0.3
const REFRESH_S = 3

const PACE = { ahead: '#2FB26B', onTrack: '#E0A100', behind: '#E5484D' }
const BG = '#1E1E1E'
const DIM = '#9A9A9A'
const STRONG = '#F0F0F0'
const ALERT = '#FF6B6B'
const TRACK = '#4A4A4A'
const MARKER = '#BBBBBB'
const HEIGHT = 24
const PAD_X = 10
const GAUGE_W = 112, GAUGE_H = 12, BAR_H = 6

const fontRegular = $.NSFont.systemFontOfSize(12)
const fontBold = $.NSFont.systemFontOfSizeWeight(12, 0.3) // NSFontWeightSemibold

function color(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha === undefined ? 1 : alpha)
}

function readText(path) {
  const s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)
  return ObjC.unwrap(s)
}

function writeText(path, text) {
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(supportDir, true, $(), null)
  $(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)
}

// La ligne la plus récente parmi les fichiers du mod (une copie par installation).
function readDisplay() {
  const names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(storeDir, null)) || []
  let best = null
  for (const name of names) {
    if (!/^budget-tokens_.*\.json$/.test(name)) continue
    try {
      const display = JSON.parse(readText(storeDir + '/' + name)).display
      if (display && typeof display === 'object' && (!best || (display.at || 0) > (best.at || 0))) best = display
    } catch (e) { }
  }
  return best
}

function ageLabel(seconds) {
  if (seconds < 90) return "à l'instant"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(seconds / 3600)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.round(seconds / 86400)} j`
}

// true : Claude au premier plan ; false : une autre app ; null : ne rien changer.
function claudeInFront() {
  const front = $.NSWorkspace.sharedWorkspace.frontmostApplication
  if (!ObjC.unwrap(front)) return null
  if (front.processIdentifier === ownPid) return null // l'overlay lui-même (on le déplace, son menu est ouvert)
  const bundle = ObjC.unwrap(front.bundleIdentifier) || ''
  const name = ObjC.unwrap(front.localizedName) || ''
  return bundle === 'com.anthropic.claudefordesktop' || bundle.startsWith('com.anthropic.claude') || name === 'Claude'
}

// --- Fenêtre ---------------------------------------------------------------

let panel = null

// Une vue transparente posée sur le contenu : elle prend le glisser et le clic droit.
ObjC.registerSubclass({
  name: 'BTDragView',
  superclass: 'NSView',
  methods: {
    'mouseDown:': { types: ['void', ['id']], implementation: function (event) { panel.performWindowDragWithEvent(event) } },
    'acceptsFirstMouse:': { types: ['bool', ['id']], implementation: function (event) { return true } },
    'mouseDownCanMoveWindow': { types: ['bool', []], implementation: function () { return true } },
  },
})

ObjC.registerSubclass({
  name: 'BTController',
  superclass: 'NSObject',
  methods: {
    'focusTick:': { types: ['void', ['id']], implementation: function (timer) { try { followFocus() } catch (e) { } } },
    'refreshTick:': { types: ['void', ['id']], implementation: function (timer) { try { if (panel.isVisible) refresh() } catch (e) { } } },
    'quit:': { types: ['void', ['id']], implementation: function (sender) { $.NSApp.terminate(null) } },
  },
})

const app = $.NSApplication.sharedApplication
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory)
const controller = $.BTController.alloc.init

// Sans bordure (0) et sans activer l'overlay au clic (NSWindowStyleMaskNonactivatingPanel).
panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, 300, HEIGHT), 1 << 7, $.NSBackingStoreBuffered, false)
panel.setFloatingPanel(true)
panel.setHidesOnDeactivate(false)
panel.setLevel(3) // NSFloatingWindowLevel
panel.setOpaque(false)
panel.setBackgroundColor($.NSColor.clearColor)
panel.setHasShadow(true)
panel.setReleasedWhenClosed(false)
// Sur tous les bureaux, y compris quand Claude est en plein écran.
panel.setCollectionBehavior((1 << 0) | (1 << 8))
panel.setTitle('budget-tokens')

const root = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 300, HEIGHT))
panel.setContentView(root)

const menu = $.NSMenu.alloc.initWithTitle('budget-tokens')
const quitItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Quitter budget-tokens', 'quit:', '')
quitItem.setTarget(controller)
menu.addItem(quitItem)

function box(x, y, w, h, hex, radius, alpha) {
  const b = $.NSBox.alloc.initWithFrame($.NSMakeRect(x, y, w, h))
  b.setBoxType(4) // NSBoxCustom
  b.setTitlePosition(0) // NSNoTitle
  b.setBorderWidth(0)
  b.setCornerRadius(radius)
  b.setFillColor(color(hex, alpha))
  b.setContentViewMargins($.NSMakeSize(0, 0))
  root.addSubview(b)
  return b
}

// --- Dessin de la ligne -----------------------------------------------------

let cursor = PAD_X

function text(str, hex, bold) {
  const label = $.NSTextField.labelWithString(str)
  label.setFont(bold ? fontBold : fontRegular)
  label.setTextColor(color(hex))
  label.setDrawsBackground(false)
  label.setBezeled(false)
  label.sizeToFit
  const size = label.frame.size
  label.setFrameOrigin($.NSMakePoint(cursor, Math.round((HEIGHT - size.height) / 2)))
  root.addSubview(label)
  cursor += size.width
}

// La jauge : le rempli est ce qui est consommé, le trait est là où l'on "devrait" être.
function gauge(used, expected, hex) {
  const left = cursor + 8
  const bottom = (HEIGHT - GAUGE_H) / 2
  const barY = bottom + (GAUGE_H - BAR_H) / 2
  box(left, barY, GAUGE_W, BAR_H, TRACK, 3)
  const fill = Math.max(0, Math.min(GAUGE_W, GAUGE_W * used / 100))
  if (fill > 0) box(left, barY, fill, BAR_H, hex, 3)
  const mark = Math.max(1, Math.min(GAUGE_W - 1, GAUGE_W * expected / 100))
  box(left + mark - 1, bottom, 2, GAUGE_H, MARKER, 1)
  cursor = left + GAUGE_W + 8
}

function render(display, now) {
  for (const view of ObjC.unwrap(root.subviews) || []) view.removeFromSuperview
  cursor = PAD_X
  const background = box(0, 0, 10, HEIGHT, BG, 8, 0.94)

  if (!display) {
    text('● budget-tokens', STRONG, true)
    text('  en attente du premier relevé : ouvre une session Code dans Claude Desktop', DIM)
  } else {
    const pace = PACE[display.pace] || STRONG
    text('● ', pace)
    text(String(display.status || ''), pace, true)
    if (display.gauge) gauge(Number(display.gauge.used) || 0, Number(display.gauge.expected) || 0, pace)
    else text('  ', DIM)

    const isSilent = now - (display.at || 0) > SILENT_AFTER_MS
    let parts = Array.isArray(display.parts) ? display.parts : []
    // Le mod ne tourne plus : son âge du relevé est figé, on met le nôtre à la fin.
    if (isSilent) parts = parts.filter(p => !(p && p[0] && String(p[0].text || '').startsWith('relevé ')))

    const tones = { dim: [DIM, false], strong: [STRONG, true], alert: [ALERT, true], pace: [pace, true] }
    parts.forEach((runs, i) => {
      if (i > 0) text('   ', DIM)
      for (const run of runs || []) {
        const [hex, bold] = tones[run.tone] || tones.dim
        text(String(run.text || ''), hex, bold)
      }
    })

    if (isSilent) text(`   relevé ${ageLabel((now - (display.readingAt || 0)) / 1000)} · ouvre une session Code pour actualiser`, DIM)
  }

  const width = Math.ceil(cursor + PAD_X)
  background.setFrame($.NSMakeRect(0, 0, width, HEIGHT))
  const drag = $.BTDragView.alloc.initWithFrame($.NSMakeRect(0, 0, width, HEIGHT))
  drag.setMenu(menu)
  root.addSubview(drag)

  // Le bord gauche et le haut restent en place quand la largeur change.
  const frame = panel.frame
  const top = frame.origin.y + frame.size.height
  panel.setFrame($.NSMakeRect(frame.origin.x, top - HEIGHT, width, HEIGHT), true)
  root.setFrame($.NSMakeRect(0, 0, width, HEIGHT))
}

// --- Position ---------------------------------------------------------------

// Mémorisée par le coin haut gauche (coordonnées Cocoa, origine en bas à gauche).
function savedPosition() {
  try {
    const pos = JSON.parse(readText(positionFile))
    const x = Number(pos.x), top = Number(pos.top)
    if (!isFinite(x) || !isFinite(top)) return null
    const screens = ObjC.unwrap($.NSScreen.screens) || []
    const onScreen = screens.some(s => {
      const f = s.frame
      return x >= f.origin.x && x < f.origin.x + f.size.width - 40 && top > f.origin.y + 20 && top <= f.origin.y + f.size.height
    })
    return onScreen ? { x, top } : null
  } catch (e) {
    return null
  }
}

let placed = false
function place() {
  const pos = savedPosition()
  const width = panel.frame.size.width
  let x, top
  if (pos) {
    x = pos.x; top = pos.top
  } else {
    // En haut au centre de l'écran principal, sous la barre des menus.
    const area = $.NSScreen.mainScreen.visibleFrame
    x = area.origin.x + (area.size.width - width) / 2
    top = area.origin.y + area.size.height - 6
  }
  panel.setFrameTopLeftPoint($.NSMakePoint(Math.round(x), Math.round(top)))
  placed = true
  lastSaved = positionKey()
}

function positionKey() {
  const f = panel.frame
  return JSON.stringify({ x: Math.round(f.origin.x), top: Math.round(f.origin.y + f.size.height) })
}

let lastSaved = null
function savePositionIfMoved() {
  if ($.NSEvent.pressedMouseButtons !== 0) return // encore en train de glisser
  const key = positionKey()
  if (key === lastSaved) return
  lastSaved = key
  try { writeText(positionFile, key) } catch (e) { }
}

// --- Boucle -----------------------------------------------------------------

let lastKey = null
function refresh() {
  const now = Date.now()
  const display = readDisplay()
  const key = JSON.stringify(display) + '|' + Math.floor(now / 60000)
  if (key === lastKey) return
  lastKey = key
  render(display, now)
  if (!placed) place()
}

function followFocus() {
  const inFront = claudeInFront()
  if (inFront === true && !panel.isVisible) {
    refresh()
    panel.orderFrontRegardless
  } else if (inFront === false && panel.isVisible) {
    panel.orderOut(null)
  }
  if (panel.isVisible) savePositionIfMoved()
}

$.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(FOCUS_S, controller, 'focusTick:', null, true)
$.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(REFRESH_S, controller, 'refreshTick:', null, true)
app.run
