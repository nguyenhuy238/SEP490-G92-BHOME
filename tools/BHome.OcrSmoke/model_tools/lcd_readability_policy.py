"""Pure offline experiment decisions; no model dependencies or billing authority."""
from collections import Counter


def accept(row,method,threshold):
    if threshold is None:return False
    if method=='pixel_contrast':return row['pixel']['localContrast95']>=threshold
    visual=row['visual'];readable=visual['prediction']=='readable_candidate' and visual['score']>=threshold and visual['margin']>=.1
    active=row['pixel']['localContrast95']>=.025 and row['pixel']['foregroundSupportComponents']>=1 and row['pixel']['smallHolesPerEstimatedGlyph']<3
    if method=='shape_primary':
        nonreadable_veto=visual['prediction']!='readable_candidate' and visual['score']>=threshold and visual['margin']>=.1
        return active and not nonreadable_veto
    if method=='shape_combined':return readable and active
    return readable and (method!='combined' or row['pixel']['localContrast95']>=.025)


def metrics(rows,method,threshold):
    count=Counter()
    for row in rows:
        accepted=accept(row,method,threshold);positive=row['expectedReadable']
        count.update(inputs=1,readablePositives=positive,negativeControls=not positive,
                     correctlyAcceptedReadable=accepted and positive,incorrectReadableRejection=not accepted and positive,
                     correctlyRejectedNegative=not accepted and not positive,falseReadableAcceptance=accepted and not positive)
    return count
