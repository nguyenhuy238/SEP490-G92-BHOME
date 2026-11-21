#!/usr/bin/env python3
"""Read-only effective SMTP preflight. Never prints credentials or sends mail."""
import argparse
import json
import smtplib
import ssl
import subprocess
import sys

CONTAINERS = {'staging': 'bhome-sepay-api-stage', 'production': 'bhome-vps-api-1'}


class EmailPreflightError(ValueError):
    pass


def validate(settings, target, recipient=None):
    expected = 'Staging' if target == 'staging' else 'Production'
    if settings.get('ASPNETCORE_ENVIRONMENT') != expected:
        raise EmailPreflightError('email_environment_mismatch')
    for key in ('Email__Enabled', 'NotificationChannels__Enabled', 'Email__UseStartTls'):
        if str(settings.get(key, '')).lower() != 'true':
            raise EmailPreflightError('email_required_setting_disabled: ' + key)
    if settings.get('Email__DeliveryMode', 'Smtp') != 'Smtp':
        raise EmailPreflightError('email_deployed_transport_must_be_smtp')
    for key in ('Email__Host', 'Email__Username', 'Email__FromEmail', 'Email__AppPassword'):
        if not str(settings.get(key, '')).strip():
            raise EmailPreflightError('email_required_setting_missing: ' + key)
    if str(settings.get('Email__AllowAnyRecipientInDevelopment', '')).lower() == 'true':
        raise EmailPreflightError('email_development_override_in_deployment')
    try:
        valid_port = 1 <= int(settings.get('Email__Port', '587')) <= 65535
    except (ValueError, TypeError):
        valid_port = False
    if not valid_port:
        raise EmailPreflightError('email_port_invalid')
    recipients = [str(value).casefold() for key, value in settings.items()
                  if key.startswith('Email__AllowedRecipients__')]
    if target == 'staging' and not any(recipients):
        raise EmailPreflightError('email_staging_allowlist_missing')
    if recipient and recipients and recipient.casefold() not in recipients:
        raise EmailPreflightError('email_recipient_not_allowed')


def effective_settings(container):
    def docker(*args):
        return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.DEVNULL)
    environment = dict(value.split('=', 1) for value in json.loads(docker('inspect', container))[0]['Config']['Env'])
    # Defaults are lower priority than injected environment. No values are printed.
    defaults = json.loads(docker('exec', container, 'cat', '/app/appsettings.json'))
    for section in ('Email', 'NotificationChannels'):
        for key, value in defaults.get(section, {}).items():
            if isinstance(value, list):
                for index, item in enumerate(value):
                    environment.setdefault(f'{section}__{key}__{index}', item)
            else:
                environment.setdefault(f'{section}__{key}', value)
    return environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=CONTAINERS)
    parser.add_argument('--recipient', help='Check permission without sending; avoid private addresses in shared logs.')
    parser.add_argument('--smtp', action='store_true', help='Verify STARTTLS certificate and SMTP login; no message submitted.')
    args = parser.parse_args()
    settings = effective_settings(CONTAINERS[args.target])
    validate(settings, args.target, args.recipient)
    print('PASS: effective email configuration and recipient scope; ' + args.target)
    if args.smtp:
        with smtplib.SMTP(settings['Email__Host'], int(settings.get('Email__Port', 587)), timeout=15) as client:
            client.ehlo()
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
            client.login(settings['Email__Username'], settings['Email__AppPassword'].replace(' ', ''))
        print('PASS: SMTP STARTTLS and authentication; no email sent, inbox delivery not verified')


if __name__ == '__main__':
    try:
        main()
    except EmailPreflightError as error:
        print('FAIL: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Provider errors may contain addresses or credentials. Output only the type.
        print('FAIL: email preflight ' + type(error).__name__ + '; values withheld', file=sys.stderr)
        sys.exit(1)
