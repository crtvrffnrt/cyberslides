#!/usr/bin/env python3
import atexit
import os
import signal
import sys
import time
from math import sin
from shutil import get_terminal_size

PART1 = "end of Presentation"
PART2 = "reached"

# 8-line tall blocky ASCII font definition (7 rows glyph + 1 row spacing)
FONT = {
    "E": [
        "██████",
        "██    ",
        "██    ",
        "█████ ",
        "██    ",
        "██    ",
        "██████",
        "      "
    ],
    "N": [
        "██  ██",
        "███ ██",
        "██████",
        "██████",
        "██ ███",
        "██  ██",
        "██  ██",
        "      "
    ],
    "D": [
        "█████ ",
        "██  ██",
        "██  ██",
        "██  ██",
        "██  ██",
        "██  ██",
        "█████ ",
        "      "
    ],
    "O": [
        " ████ ",
        "██  ██",
        "██  ██",
        "██  ██",
        "██  ██",
        "██  ██",
        " ████ ",
        "      "
    ],
    "F": [
        "██████",
        "██    ",
        "██    ",
        "█████ ",
        "██    ",
        "██    ",
        "██    ",
        "      "
    ],
    "P": [
        "██████",
        "██  ██",
        "██  ██",
        "██████",
        "██    ",
        "██    ",
        "██    ",
        "      "
    ],
    "R": [
        "██████",
        "██  ██",
        "██  ██",
        "██████",
        "██ ██ ",
        "██  ██",
        "██  ██",
        "      "
    ],
    "S": [
        " █████",
        "██    ",
        "██    ",
        " ████ ",
        "    ██",
        "    ██",
        "█████ ",
        "      "
    ],
    "T": [
        "██████",
        "  ██  ",
        "  ██  ",
        "  ██  ",
        "  ██  ",
        "  ██  ",
        "  ██  ",
        "      "
    ],
    "A": [
        " ████ ",
        "██  ██",
        "██  ██",
        "██████",
        "██  ██",
        "██  ██",
        "██  ██",
        "      "
    ],
    "I": [
        "██████",
        "  ██  ",
        "  ██  ",
        "  ██  ",
        "  ██  ",
        "  ██  ",
        "██████",
        "      "
    ],
    "C": [
        " █████",
        "██    ",
        "██    ",
        "██    ",
        "██    ",
        "██    ",
        " █████",
        "      "
    ],
    "H": [
        "██  ██",
        "██  ██",
        "██  ██",
        "██████",
        "██  ██",
        "██  ██",
        "██  ██",
        "      "
    ],
    " ": [
        "      ",
        "      ",
        "      ",
        "      ",
        "      ",
        "      ",
        "      ",
        "      "
    ]
}


def get_banner_lines(text):
    char_blocks = []
    for char in text:
        key = char.upper()
        block = FONT.get(key, FONT[" "])
        char_blocks.append(block)

    banner_lines = []
    for i in range(8):
        banner_lines.append("  ".join(block[i] for block in char_blocks))
    return banner_lines


def hide_cursor():
    sys.stdout.write("\x1b[?25l")


def show_cursor():
    sys.stdout.write("\x1b[?25h")


def reset():
    sys.stdout.write("\x1b[0m")


def clear():
    sys.stdout.write("\x1b[2J\x1b[H")


def render():
    hide_cursor()
    # Force black background on the terminal screen
    sys.stdout.write("\x1b[40m")
    clear()

    last_size = (0, 0)

    try:
        while True:
            size = get_terminal_size(fallback=(80, 24))
            width = max(1, size.columns)
            height = max(10, size.lines)

            # Clear screen only when terminal is resized to prevent flicker
            if (width, height) != last_size:
                clear()
                last_size = (width, height)

            # Split text dynamically depending on the terminal width
            if width >= 150:
                text_lines = [PART1, PART2]
            else:
                text_lines = ["end of", "Presentation", PART2]

            t = time.time()
            h_required = len(text_lines) * 8
            text_start = max(0, (height - h_required) // 2)

            # Pre-calculate banner lines for each text line
            banners = [get_banner_lines(line) for line in text_lines]

            lines = []
            for r in range(height):
                if text_start <= r < text_start + h_required:
                    banner_idx = (r - text_start) // 8
                    banner_row = (r - text_start) % 8
                    banner_lines = banners[banner_idx]
                    banner_width = len(banner_lines[0])

                    if width >= banner_width:
                        left_pad = (width - banner_width) // 2
                        right_pad = width - left_pad - banner_width
                        slice_start = 0
                        slice_end = banner_width
                    else:
                        left_pad = 0
                        right_pad = 0
                        slice_start = (banner_width - width) // 2
                        slice_end = slice_start + width

                    visible_slice = banner_lines[banner_row][slice_start:slice_end]

                    # Apply neon cyber gradient (Cyan to Purple/Magenta transition)
                    colored_chars = []
                    in_color = False
                    for idx, char in enumerate(visible_slice):
                        if char == " ":
                            if in_color:
                                colored_chars.append("\x1b[0;40m")
                                in_color = False
                            colored_chars.append(" ")
                        else:
                            c = left_pad + idx
                            # Sine-wave mapping for smooth color transitions
                            f = 0.5 + 0.5 * sin(t * 2.0 + c * 0.05)
                            r_val = int(255 * f)
                            g_val = int(255 * (1 - f))
                            b_val = 255
                            colored_chars.append(f"\x1b[38;2;{r_val};{g_val};{b_val}m{char}")
                            in_color = True

                    if in_color:
                        colored_chars.append("\x1b[0;40m")

                    line_content = "".join(colored_chars)
                    lines.append(" " * left_pad + line_content + " " * right_pad)

                elif r == text_start + h_required + 1:
                    # Subtle, nerdy console interface subtitle
                    subtitle = "[ PRESS CTRL+C TO EXIT ]"
                    centered = subtitle.center(width)
                    # Use dim white foreground on black background
                    lines.append(f"\x1b[2;37;40m{centered}\x1b[0;40m")
                else:
                    lines.append(" " * width)

            # Overwrite screen smoothly by resetting cursor position
            sys.stdout.write("\x1b[H" + "\n".join(lines))
            sys.stdout.flush()
            time.sleep(0.03)

    except KeyboardInterrupt:
        pass


def main():
    def cleanup(*_):
        reset()
        show_cursor()
        sys.stdout.write("\n")
        sys.stdout.flush()

    atexit.register(cleanup)
    signal.signal(signal.SIGINT, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    render()


if __name__ == "__main__":
    main()
