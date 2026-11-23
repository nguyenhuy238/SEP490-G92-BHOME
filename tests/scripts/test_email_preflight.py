import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('email_preflight', Path(__file__).resolve().parents[2] / 'deploy/vps/check-email.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class EmailPreflightTests(unittest.TestCase):
    def settings(self, target='staging'):
        return {'ASPNETCORE_ENVIRONMENT': 'Staging' if target == 'staging' else 'Production',
                'Email__Enabled': 'true', 'NotificationChannels__Enabled': 'true',
                'Email__UseStartTls': 'true', 'Email__Host': 'smtp.example.invalid',
                'Email__Username': 'sender@example.invalid', 'Email__FromEmail': 'sender@example.invalid',
                'Email__AppPassword': 'SYNTHETIC_SECRET', 'Email__AllowedRecipients__0': 'approved@example.invalid'}

    def test_staging_accepts_approved_recipient_case_insensitively(self):
        preflight.validate(self.settings(), 'staging', 'APPROVED@example.invalid')

    def test_every_deployment_ignores_old_recipient_settings(self):
        for target in ('staging', 'production'):
            for value in ('approved@example.invalid', '', 'invalid'):
                with self.subTest(target=target, value=value):
                    settings = self.settings(target)
                    settings['Email__AllowedRecipients__0'] = value
                    settings['Email__AllowAnyRecipientInDevelopment'] = 'true'
                    preflight.validate(settings, target, 'outside@example.invalid')

    def test_disabled_email_or_channels_or_tls_are_detected(self):
        for key in ('Email__Enabled', 'NotificationChannels__Enabled', 'Email__UseStartTls'):
            with self.subTest(key=key):
                settings = self.settings()
                settings[key] = 'false'
                with self.assertRaisesRegex(ValueError, 'email_required_setting_disabled'):
                    preflight.validate(settings, 'staging')

    def test_no_deployment_requires_allowlist(self):
        for target in ('staging', 'production'):
            settings = self.settings(target)
            del settings['Email__AllowedRecipients__0']
            preflight.validate(settings, target, 'normal@example.invalid')

    def test_rejects_environment_and_capture_on_deployment(self):
        for key, value in [('ASPNETCORE_ENVIRONMENT', 'Development'), ('Email__DeliveryMode', 'Capture')]:
            with self.subTest(key=key):
                settings = self.settings()
                settings[key] = value
                with self.assertRaises(ValueError):
                    preflight.validate(settings, 'staging')

    def test_invalid_recipient_is_still_rejected(self):
        for recipient in ('invalid', '', 'one@example.invalid,two@example.invalid', 'one@example.invalid\r\nBcc: attacker@example.invalid'):
            with self.subTest(recipient=recipient), self.assertRaisesRegex(ValueError, '^email_recipient_invalid$'):
                preflight.validate(self.settings(), 'staging', recipient)

    def test_missing_credential_and_invalid_port_do_not_leak_values(self):
        for key, value in [('Email__AppPassword', ''), ('Email__Port', 'invalid'), ('Email__Port', '0')]:
            with self.subTest(key=key):
                settings = self.settings()
                settings[key] = value
                with self.assertRaises(ValueError) as error:
                    preflight.validate(settings, 'staging')
                self.assertNotIn('SYNTHETIC_SECRET', str(error.exception))
                self.assertNotIn('sender@example.invalid', str(error.exception))


if __name__ == '__main__':
    unittest.main()
