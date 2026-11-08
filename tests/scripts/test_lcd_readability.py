"""Decision invariants only; synthetic signals are not meter accuracy evidence."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools/BHome.OcrSmoke/model_tools'))
from lcd_readability_policy import accept


class ReadabilityDecisionTests(unittest.TestCase):
    def row(self):
        return {'pixel':{'localContrast95':.1,'foregroundSupportComponents':6,'smallHolesPerEstimatedGlyph':0},
                'visual':{'prediction':'readable_candidate','score':.95,'margin':.8},
                'recognition':{'english':{'raw':'88888','digits':'88888'}}}

    def test_all_numeric_text_does_not_override_nonreadable_image_evidence(self):
        row=self.row();row['visual']['prediction']='blank_or_unpowered'
        self.assertFalse(accept(row,'shape_combined',.5))

    def test_valid_repeated_digits_are_not_rejected_by_a_string_pattern(self):
        row=self.row();self.assertTrue(accept(row,'shape_combined',.5))
        row['pixel']['smallHolesPerEstimatedGlyph']=4
        self.assertFalse(accept(row,'shape_combined',.5))

    def test_failed_calibration_has_no_accepted_policy(self):
        self.assertFalse(accept(self.row(),'shape_primary',None))


if __name__=='__main__':unittest.main()
