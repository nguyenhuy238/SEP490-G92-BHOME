"""Match actual Stage2 boxes to publisher polygons, including rejected sequences.

IoU0.3 is an evaluation matching threshold only; production thresholds unchanged.
Unknown annotations are tracked separately, never guessed into numeric labels.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment


def iou(a,b):
    a=cv2.convexHull(np.asarray(a,dtype=np.float32));b=cv2.convexHull(np.asarray(b,dtype=np.float32))
    intersection,_=cv2.intersectConvexConvex(a,b)
    union=cv2.contourArea(a)+cv2.contourArea(b)-intersection
    return float(intersection/union) if union>0 else 0


def transform(polygon,width,height):
    points=sorted(polygon,key=lambda p:p[0]);left=sorted(points[:2],key=lambda p:p[1]);right=sorted(points[2:],key=lambda p:p[1])
    source=np.asarray([left[0],right[0],right[1],left[1]],np.float32)
    return cv2.getPerspectiveTransform(source,np.array([[0,0],[width-1,0],[width-1,height-1],[0,height-1]],np.float32))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('diagnostic',type=Path);p.add_argument('images',type=Path);p.add_argument('report',type=Path)
    a=p.parse_args();data=json.loads(a.diagnostic.read_text(encoding='utf-8')); rows=[];totals={}
    for sample in data['rows']:
        labels=[]
        for line in (a.images/Path(sample['imageId']).with_suffix('.txt')).read_text().splitlines():
            parts=line.split()
            if not parts:continue
            cls=int(parts[0])
            if 2<=cls<=12:
                points=np.asarray(list(map(float,parts[1:])),np.float32).reshape(4,2)*[sample['width'],sample['height']]
                labels.append((cls-2,points))
        for mode in sample['modes']:
            key=mode['mode']
            if key not in ('predicted_window','oracle_window'):continue
            polygon=(sample['predictedWindows'][0]['points'] if key=='predicted_window' else sample['groundTruthWindows'][0])
            matrix=transform(polygon,mode['width'],mode['height'])
            gt=[(cls,cv2.perspectiveTransform(points.astype(np.float32)[None],matrix)[0]) for cls,points in labels]
            pred=mode['digitCandidates']; overlaps=np.array([[iou(g[1],box['points']) for box in pred] for g in gt])
            matched=[]
            if gt and pred:
                gi,pi=linear_sum_assignment(-overlaps)
                matched=[(int(g),int(b)) for g,b in zip(gi,pi) if overlaps[g,b]>=.3]
            gmatched={g for g,b in matched};pmatched={b for g,b in matched}
            c=Counter(knownAnnotatedDigits=sum(g[0]<10 for g in gt),unknownAnnotatedPositions=sum(g[0]==10 for g in gt),predictedBoxes=len(pred),
                missingKnownDigits=sum(g[0]<10 and i not in gmatched for i,g in enumerate(gt)),extraBoxes=len(pred)-len(pmatched),
                matchedCorrectDigits=sum(gt[g][0]<10 and gt[g][0]==pred[b]['classId'] for g,b in matched),
                matchedWrongDigits=sum(gt[g][0]<10 and pred[b]['classId']<10 and gt[g][0]!=pred[b]['classId'] for g,b in matched),
                unknownPredictionAtKnownDigit=sum(gt[g][0]<10 and pred[b]['classId']==10 for g,b in matched))
            ordered=sorted(matched,key=lambda pair:gt[pair[0]][1][:,0].mean())
            positions=[np.asarray(pred[b]['points'])[:,0].mean() for g,b in ordered]
            c['orderingInversions']=int(sum(positions[i]>positions[i+1] for i in range(len(positions)-1)))
            totals.setdefault(key,Counter()).update(c)
            rows.append({'imageId':sample['imageId'],'mode':key,'counts':dict(c)})
    a.report.write_text(json.dumps({'matchingIoU':.3,'productionThresholdChanged':False,'metrics':totals,'rows':rows,
        'limitations':['Publisher annotation omissions remain missing GT; no labels repaired using model predictions.',
                       'Unknown physical-meter independence. Matching errors are not confirmed billing errors.']},indent=2)+'\n',encoding='utf-8')
    print(json.dumps(totals))


if __name__=='__main__':main()
