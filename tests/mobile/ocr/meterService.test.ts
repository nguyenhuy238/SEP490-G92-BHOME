import { describe, expect, it, vi } from 'vitest';
import { meterService } from '../../../src/mobile/src/services/meterService';
import { MobileApi } from '../../../src/mobile/src/lib/api';

describe('persisted confirmed meter results', () => {
  it('retrieves the exact task and confirmed result without relying on the capped task list', async () => {
    const result = {
      id: 'reading',
      taskId: 'older-task',
      previousValue: '100',
      confirmedValue: '125.5',
      consumption: '25.5',
      status: 0,
      confirmedAt: '2026-11-01T00:00:00Z',
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'older-task', confirmedReadingId: result.id })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    const service = meterService(
      new MobileApi(
        'https://example.invalid',
        () => 'synthetic',
        async () => undefined,
        () => {},
        transport,
      ),
    );
    const task = await service.task('older-task');
    expect(await service.reading(task.confirmedReadingId!)).toEqual(result);
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      'https://example.invalid/api/v1/capture/meter-tasks/older-task',
      'https://example.invalid/api/v1/capture/readings/reading',
    ]);
  });
  it('sends the confirmed decimal string and evidence; never calculates consumption locally', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'saved', consumption: '25.5' })));
    const service = meterService(
      new MobileApi(
        'https://example.invalid',
        () => 'synthetic',
        async () => undefined,
        () => {},
        transport,
      ),
    );
    expect(await service.confirm('task', '125.5', 'evidence')).toEqual({
      id: 'saved',
      consumption: '25.5',
    });
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({
      humanConfirmed: true,
      confirmedValue: '125.5',
      evidenceId: 'evidence',
    });
  });
});
