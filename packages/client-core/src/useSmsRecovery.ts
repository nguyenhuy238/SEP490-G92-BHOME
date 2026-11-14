import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import type { SessionClient } from './sessionClient';

const passwordRule = /^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\p{Nd})(?=.*[^\p{L}\p{N}]).{12,1024}$/u;
export function useSmsRecovery(client: SessionClient) {
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [step, setStep] = useState<'request' | 'verify' | 'reset' | 'success'>('request');
  const [challengeId, setChallengeId] = useState('');
  const [authorization, setAuthorization] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const lock = useRef(false);
  useEffect(() => {
    if (!retryAt) return;
    // Track time, not the previous deadline: a queued tick must not erase a new countdown.
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [retryAt]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
          : failure instanceof ApiError && failure.status === 503
            ? 'Khôi phục qua SMS chưa khả dụng. Vui lòng dùng email hoặc liên hệ Owner.'
            : failure instanceof ApiError && failure.status === 400
              ? 'Mã không hợp lệ, đã hết hạn hoặc mật khẩu chưa đạt yêu cầu.'
              : 'Chưa thể kết nối. Vui lòng thử lại.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function request() {
    if (busy || Date.now() < retryAt) return;
    if (!identifier.trim() || identifier.trim().length > 256) {
      setError('Vui lòng nhập tài khoản hoặc số điện thoại đã xác minh.');
      return;
    }
    await run(async () => {
      const result = await client.requestSmsRecovery(identifier.trim());
      setChallengeId(result.challengeId);
      const receivedAt = Date.now();
      setNow(receivedAt);
      setRetryAt(receivedAt + result.retryAfterSeconds * 1000);
      setOtp('');
      setAuthorization('');
      setStep('verify');
    });
  }
  async function verify() {
    if (!/^[0-9]{6}$/.test(otp)) {
      setError('Vui lòng nhập mã gồm 6 chữ số.');
      return;
    }
    await run(async () => {
      const result = await client.verifySmsRecovery(identifier.trim(), challengeId, otp);
      setAuthorization(result.authorization);
      setOtp('');
      setStep('reset');
    });
  }
  async function reset() {
    if (password !== confirmation) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    if (!passwordRule.test(password)) {
      setError('Mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.');
      return;
    }
    await run(async () => {
      await client.resetSmsPassword(
        identifier.trim(),
        challengeId,
        authorization,
        password,
        confirmation,
      );
      setPassword('');
      setConfirmation('');
      setAuthorization('');
      setChallengeId('');
      setStep('success');
    });
  }
  function restart() {
    setStep('request');
    setOtp('');
    setAuthorization('');
    setPassword('');
    setConfirmation('');
    setError('');
  }
  return {
    identifier,
    setIdentifier,
    otp,
    setOtp,
    password,
    setPassword,
    confirmation,
    setConfirmation,
    step,
    busy,
    error,
    seconds,
    request,
    verify,
    reset,
    restart,
  };
}
