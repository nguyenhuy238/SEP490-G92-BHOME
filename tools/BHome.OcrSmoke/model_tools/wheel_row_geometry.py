"""Experimental row assembly from observed numeric boxes, without expected count."""


def group_rows(candidates):
    groups = []
    for candidate in sorted(candidates, key=lambda c: (c['box'][0], c['box'][1])):
        raw = candidate['raw']
        if not raw or any(c not in '0123456789' for c in raw): continue
        box = candidate['box']; height = box[3] - box[1]
        compatible = []
        for group in groups:
            previous = group[-1]; last = previous['box']; old_height = last[3] - last[1]
            if (.6 <= height / old_height <= 1 / .6 and
                abs((box[1] + box[3] - last[1] - last[3]) / 2) <= .4 * min(height, old_height) and
                0 <= box[0] - last[2] <= 1.5 * min(height, old_height)):
                compatible.append(group)
        if compatible: compatible[0].append(candidate)
        else: groups.append([candidate])
    rows = []
    for group in groups:
        group = sorted(group, key=lambda c: c['box'][0])
        rows.append({'raw': ''.join(c['raw'] for c in group),
                     'box': [min(c['box'][0] for c in group), min(c['box'][1] for c in group),
                             max(c['box'][2] for c in group), max(c['box'][3] for c in group)],
                     'observedRegions': len(group), 'minimumCharacterScore': min(c['minimumCharacterScore'] for c in group)})
    return sorted(rows, key=lambda r: (r['box'][3] - r['box'][1], r['box'][2] - r['box'][0]), reverse=True)
