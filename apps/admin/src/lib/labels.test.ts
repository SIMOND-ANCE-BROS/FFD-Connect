import { describe, expect, it } from 'vitest';
import { paymentConfigured, paymentProviderLabel } from './labels';

describe('payment connector labels (#665)', () => {
  it('names a known connector and keeps an unknown one as is', () => {
    expect(paymentProviderLabel('HELLOASSO')).toBe('HelloAsso');
    expect(paymentProviderLabel('ASSOCONNECT')).toBe('ASSOCONNECT');
  });

  it('reads the HelloAsso credentials for a HelloAsso club only', () => {
    expect(paymentConfigured({ paymentProvider: 'HELLOASSO', helloAssoConfigured: true })).toBe(
      true,
    );
    expect(paymentConfigured({ paymentProvider: 'HELLOASSO', helloAssoConfigured: false })).toBe(
      false,
    );
    expect(
      paymentConfigured({ paymentProvider: 'ASSOCONNECT', helloAssoConfigured: true }),
    ).toBeNull();
  });
});
