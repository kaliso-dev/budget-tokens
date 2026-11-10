#!/usr/bin/env python3
"""Overlay budget-tokens pour Linux (X11).

Affiche la même barre que le mod budget-tokens dans Claude Code, au-dessus de
la fenêtre de Claude Desktop, seulement quand elle est au premier plan. La ligne
est calculée par le mod, qui l'écrit dans son fichier sous
~/.claude/plugins/store/ ; l'overlay ne fait que la dessiner.

Glisser pour déplacer (la position est retenue), clic droit pour quitter.
"""

import fcntl
import glob
import json
import os
import subprocess
import sys
import time
import tkinter as tk
import tkinter.font as tkfont

CONFIG_DIR = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
STORE_GLOB = os.path.join(CONFIG_DIR, 'plugins', 'store', 'budget-tokens_*.json')
POSITION_FILE = os.path.expanduser('~/.config/budget-tokens-overlay.json')
LOCK_FILE = os.path.expanduser('~/.cache/budget-tokens-overlay.lock')
APP_PATH_HINT = '/claude-desktop/'
REFRESH_MS = 3000
# La fenêtre au premier plan est relue souvent, pour suivre les changements de fenêtre.
FOCUS_MS = 300
# Au-delà, le mod ne tourne plus : aucune session Code n'est ouverte.
MOD_SILENT_AFTER = 120

PACE = {'ahead': '#2FB26B', 'onTrack': '#E0A100', 'behind': '#E5484D'}
BG = '#1E1E1E'
DIM = '#9A9A9A'
STRONG = '#F0F0F0'
ALERT = '#FF6B6B'
TRACK = '#4A4A4A'
MARKER = '#BBBBBB'
GAUGE_W, GAUGE_H, BAR_H = 112, 12, 6


def single_instance():
    """Le verrou d'une seule instance ; None quand une autre tourne déjà."""
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    handle = open(LOCK_FILE, 'w')
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def is_claude_process(pid):
    try:
        with open(f'/proc/{pid}/cmdline', 'rb') as f:
            exe = f.read().split(b'\0', 1)[0].decode('utf-8', 'replace')
    except OSError:
        return False
    return APP_PATH_HINT in exe or os.path.basename(exe) == 'claude-desktop'


class ActiveWindow:
    """Le processus de la fenêtre au premier plan (_NET_ACTIVE_WINDOW, X11).

    Par python-xlib quand il est là, sinon par la commande xprop.
    """

    def __init__(self):
        self.xlib = None
        self.last_window = None
        self.last_pid = None
        try:
            from Xlib import X, display as xdisplay
            self.X = X
            self.xlib = xdisplay.Display()
            self.root = self.xlib.screen().root
            self.active_atom = self.xlib.intern_atom('_NET_ACTIVE_WINDOW')
            self.pid_atom = self.xlib.intern_atom('_NET_WM_PID')
        except Exception:
            self.xlib = None

    def window(self):
        if self.xlib is not None:
            prop = self.root.get_full_property(self.active_atom, self.X.AnyPropertyType)
            return int(prop.value[0]) if prop and len(prop.value) else None
        out = subprocess.run(['xprop', '-root', '_NET_ACTIVE_WINDOW'], capture_output=True, text=True, timeout=2).stdout
        word = out.strip().split()[-1] if out.strip() else ''
        return int(word, 16) if word.startswith('0x') else None

    def pid_of(self, window):
        if self.xlib is not None:
            prop = self.xlib.create_resource_object('window', window).get_full_property(self.pid_atom, self.X.AnyPropertyType)
            return int(prop.value[0]) if prop and len(prop.value) else None
        out = subprocess.run(['xprop', '-id', hex(window), '_NET_WM_PID'], capture_output=True, text=True, timeout=2).stdout
        word = out.strip().split()[-1] if out.strip() else ''
        return int(word) if word.isdigit() else None

    def pid(self):
        window = self.window()
        if not window:
            return None
        if window != self.last_window:
            self.last_window = window
            self.last_pid = self.pid_of(window)
        return self.last_pid


def claude_in_front(active):
    """True : Claude au premier plan ; False : une autre fenêtre ; None : ne rien changer."""
    try:
        pid = active.pid()
    except Exception:
        return None
    if pid is None or pid == os.getpid():
        return None  # pas de fenêtre active, ou l'overlay lui-même (on le déplace)
    return is_claude_process(pid)


def read_display():
    """La ligne la plus récente parmi les fichiers du mod (une copie par installation)."""
    best = None
    for path in glob.glob(STORE_GLOB):
        try:
            with open(path, encoding='utf-8') as f:
                display = json.load(f).get('display')
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(display, dict) and (best is None or display.get('at', 0) > best.get('at', 0)):
            best = display
    return best


def age_label(seconds):
    if seconds < 90:
        return "à l'instant"
    minutes = round(seconds / 60)
    if minutes < 60:
        return f'il y a {minutes} min'
    hours = round(seconds / 3600)
    if hours < 24:
        return f'il y a {hours} h'
    return f'il y a {round(seconds / 86400)} j'


class Overlay:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title('budget-tokens')
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        try:
            self.root.attributes('-alpha', 0.94)
        except tk.TclError:
            pass
        self.root.configure(bg=BG)
        family = 'DejaVu Sans' if 'DejaVu Sans' in tkfont.families() else 'TkDefaultFont'
        self.font = tkfont.Font(family=family, size=10)
        self.bold = tkfont.Font(family=family, size=10, weight='bold')
        self.frame = tk.Frame(self.root, bg=BG, padx=10, pady=4)
        self.frame.pack()
        self.last = None
        self.placed = False
        self.drag = (0, 0)
        self.visible = True

        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label='Quitter budget-tokens', command=self.root.destroy)
        self.menu = menu
        for widget in (self.root, self.frame):
            self.bind_mouse(widget)

    def bind_mouse(self, widget):
        widget.bind('<ButtonPress-1>', self.start_drag)
        widget.bind('<B1-Motion>', self.on_drag)
        widget.bind('<ButtonRelease-1>', self.save_position)
        widget.bind('<Button-3>', lambda e: self.menu.tk_popup(e.x_root, e.y_root))

    def start_drag(self, event):
        self.drag = (event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y())

    def on_drag(self, event):
        self.root.geometry(f'+{event.x_root - self.drag[0]}+{event.y_root - self.drag[1]}')

    def save_position(self, _event):
        try:
            os.makedirs(os.path.dirname(POSITION_FILE), exist_ok=True)
            with open(POSITION_FILE, 'w', encoding='utf-8') as f:
                json.dump({'x': self.root.winfo_x(), 'y': self.root.winfo_y()}, f)
        except OSError:
            pass

    def place(self):
        self.root.update_idletasks()
        try:
            with open(POSITION_FILE, encoding='utf-8') as f:
                pos = json.load(f)
            x, y = int(pos['x']), int(pos['y'])
        except (OSError, ValueError, KeyError, TypeError):
            x = (self.root.winfo_screenwidth() - self.root.winfo_reqwidth()) // 2
            y = 6
        self.root.geometry(f'+{x}+{y}')
        self.placed = True

    def text(self, text, color, bold=False):
        label = tk.Label(self.frame, text=text, fg=color, bg=BG, font=self.bold if bold else self.font, bd=0, padx=0)
        label.pack(side='left')
        self.bind_mouse(label)

    def gauge(self, used, expected, color):
        canvas = tk.Canvas(self.frame, width=GAUGE_W, height=GAUGE_H, bg=BG, highlightthickness=0, bd=0)
        y = (GAUGE_H - BAR_H) / 2
        canvas.create_rectangle(0, y, GAUGE_W, y + BAR_H, fill=TRACK, width=0)
        fill = max(0.0, min(GAUGE_W, GAUGE_W * used / 100))
        if fill > 0:
            canvas.create_rectangle(0, y, fill, y + BAR_H, fill=color, width=0)
        mark = max(1.0, min(GAUGE_W - 1.0, GAUGE_W * expected / 100))
        canvas.create_rectangle(mark - 1, 0, mark + 1, GAUGE_H, fill=MARKER, width=0)
        canvas.pack(side='left', padx=8)
        self.bind_mouse(canvas)

    def render(self, display, now):
        for child in self.frame.winfo_children():
            child.destroy()

        if not display:
            self.text('● budget-tokens', STRONG, True)
            self.text('  en attente du premier relevé : ouvre une session Code dans Claude Desktop', DIM)
            return

        color = PACE.get(display.get('pace') or '', STRONG)
        self.text('● ', color)
        self.text(display.get('status', ''), color, True)
        gauge = display.get('gauge')
        if gauge:
            self.gauge(gauge['used'], gauge['expected'], color)
        else:
            self.text('  ', DIM)

        is_silent = now - display.get('at', 0) / 1000 > MOD_SILENT_AFTER
        parts = display.get('parts') or []
        if is_silent:
            # Le mod ne tourne plus : son âge du relevé est figé, on met le nôtre.
            parts = [p for p in parts if not (p and p[0].get('text', '').startswith('relevé '))]

        tones = {'dim': (DIM, False), 'strong': (STRONG, True), 'alert': (ALERT, True), 'pace': (color, True)}
        for i, runs in enumerate(parts):
            if i > 0:
                self.text('   ', DIM)
            for run in runs:
                fg, bold = tones.get(run.get('tone'), (DIM, False))
                self.text(run.get('text', ''), fg, bold)

        if is_silent:
            age = age_label(now - display.get('readingAt', 0) / 1000)
            self.text(f'   relevé {age} · ouvre une session Code pour actualiser', DIM)

    def refresh(self):
        now = time.time()
        display = read_display()
        key = json.dumps(display, sort_keys=True) + str(int(now // 60))
        if key != self.last:
            self.last = key
            self.render(display, now)
            if not self.placed:
                self.place()

    def follow_focus(self):
        try:
            state = claude_in_front(self.active)
            if state and not self.visible:
                self.refresh()
                self.root.deiconify()
                self.root.attributes('-topmost', True)
                self.root.lift()
                self.visible = True
            elif state is False and self.visible:
                self.root.withdraw()
                self.visible = False
        finally:
            self.root.after(FOCUS_MS, self.follow_focus)

    def tick(self):
        try:
            if self.visible:
                self.refresh()
        finally:
            self.root.after(REFRESH_MS, self.tick)

    def run(self):
        self.active = ActiveWindow()
        self.root.withdraw()
        self.visible = False
        self.follow_focus()
        self.tick()
        self.root.mainloop()


if __name__ == '__main__':
    lock = single_instance()
    if lock is None:
        sys.exit(0)
    Overlay().run()
