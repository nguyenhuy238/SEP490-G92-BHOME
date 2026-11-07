"""Synthetic annotation reconciliation tests; no real meter GT is asserted."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools/BHome.OcrSmoke/model_tools'))
from meter_review import reconcile,verify_package_images,build_manifest
from PIL import Image


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.package={'sourceGroup':'synthetic_source','samples':[{'id':'synthetic_001','sourceSha256':'a'*64}]}
        row={'id':'synthetic_001','sourceSha256':'a'*64,'category':'electricity_digital','physicalMeterGroup':None,
             'meterBox':[.1,.1,.9,.9],'windowBox':[.2,.2,.8,.4],'displayState':'single','readable':True,
             'digits':'001234','decimalPlaces':None,'unit':'kWh','register':'total_energy','uncertainPositions':[]}
        self.first={'reviewerId':'synthetic_a','humanVisualReview':True,'rows':[row]}
        self.second=deepcopy(self.first);self.second['reviewerId']='synthetic_b'

    def test_same_reviewer_or_no_human_declaration_cannot_create_consensus(self):
        with self.assertRaisesRegex(ValueError,'different'):reconcile(self.package,self.first,self.first)
        self.second['humanVisualReview']=False
        with self.assertRaisesRegex(ValueError,'declared human'):reconcile(self.package,self.first,self.second)

    def test_conflicting_digits_never_leak_into_classification_or_localization_views(self):
        self.second['rows'][0]['digits']='001235'
        result=reconcile(self.package,self.first,self.second)
        self.assertEqual([],result['views']['C_recognition'])
        for key in ['A_classification','B_localization']:
            self.assertEqual(1,len(result['views'][key]));self.assertNotIn('digits',result['views'][key][0])
        self.assertEqual('annotation_disagreement',result['pending'][0]['reason'])

    def test_leading_zeros_preserved_but_unknown_precision_is_not_billing_ground_truth(self):
        result=reconcile(self.package,self.first,self.second)
        label=result['views']['C_recognition'][0]
        self.assertEqual('001234',label['digits']);self.assertFalse(label['billingMetadataDeclared'])
        self.assertFalse(result['independentAcceptanceEstablished'])

    def test_changed_image_uncertain_digit_and_disjoint_windows_are_rejected(self):
        self.second['rows'][0]['sourceSha256']='b'*64
        with self.assertRaisesRegex(ValueError,'checksum'):reconcile(self.package,self.first,self.second)
        self.second=deepcopy(self.first);self.second['reviewerId']='synthetic_b'
        self.second['rows'][0]['uncertainPositions']=[2]
        with self.assertRaisesRegex(ValueError,'Uncertain'):reconcile(self.package,self.first,self.second)
        self.second['rows'][0]['uncertainPositions']=[];self.second['rows'][0]['windowBox']=[.2,.6,.8,.8]
        result=reconcile(self.package,self.first,self.second)
        self.assertEqual([],result['views']['C_recognition']);self.assertEqual([],result['views']['B_localization'])

    def test_review_package_rejects_image_path_escape_before_reading_outside_root(self):
        with tempfile.TemporaryDirectory() as directory:
            package={'samples':[{'image':'../outside.jpg','sourceSha256':'a'*64}]}
            with self.assertRaisesRegex(ValueError,'path/hash'):
                verify_package_images(package,Path(directory))

    def test_negative_display_state_does_not_supply_recognition_ground_truth(self):
        for doc in (self.first,self.second):
            row=doc['rows'][0];row.update(readabilityState='segment_test',digits=None,readable=False)
        result=reconcile(self.package,self.first,self.second)
        self.assertEqual([],result['views']['C_recognition'])
        self.assertEqual(1,len(result['views']['D_negative_controls']))
        self.second['rows'][0].update(digits='88888',readable=True)
        with self.assertRaisesRegex(ValueError,'Unreadable display state'):
            reconcile(self.package,self.first,self.second)

    def test_mixed_pilot_keeps_each_sources_group_after_consensus(self):
        self.package['samples'][0]['sourceGroup']='synthetic_device_source'
        result=reconcile(self.package,self.first,self.second)
        self.assertEqual('synthetic_device_source',result['views']['A_classification'][0]['sourceGroup'])

    def test_blinded_package_does_not_embed_annotation_suggestions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);image=root/'source.png';Image.new('RGB',(8,8),'white').save(image)
            manifest=root/'manifest.json'
            manifest.write_text(json.dumps({'samples':[{'id':'synthetic_001','image':'source.png',
                'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'sourceGroup':'synthetic_source',
                'digits':'001234','category':'electricity_digital','modelSuggestion':'do_not_autofill'}]}))
            build_manifest(manifest,root,root/'review')
            package=json.loads((root/'review/package.json').read_text())
            self.assertFalse(package['modelSuggestionsIncluded'])
            self.assertNotIn('digits',package['samples'][0]);self.assertNotIn('category',package['samples'][0])


if __name__=='__main__':unittest.main()
