"""Synthetic annotation reconciliation tests; no real meter GT is asserted."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools/BHome.OcrSmoke/model_tools'))
from meter_review import reconcile,verify_package_images


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


if __name__=='__main__':unittest.main()
