"""Native image tiles for offline display studies; all boxes use original pixels."""


def tile_windows(width, height, edge, overlap=.25):
    if min(width, height, edge) <= 0 or not 0 <= overlap < 1:
        raise ValueError('Invalid tile geometry')
    def starts(length):
        size = min(length, edge)
        positions = list(range(0, length - size + 1, max(1, round(edge * (1 - overlap)))))
        return sorted(set(positions + [length - size]))
    return [(x, y, min(width, x + edge), min(height, y + edge)) for y in starts(height) for x in starts(width)]
