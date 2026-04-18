import { Test, type TestingModule } from '@nestjs/testing';

import { APP_VERSION } from './app-version.provider';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: APP_VERSION, useValue: '1.2.3' }],
    }).compile();
    controller = module.get(HealthController);
  });

  it('returns status ok, injected version, and non-negative uptime', () => {
    const result = controller.getHealth();
    expect(result.status).toBe('ok');
    expect(result.version).toBe('1.2.3');
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });
});
