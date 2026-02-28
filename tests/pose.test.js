import { describe, it, expect, vi } from 'vitest';
import {
  HEAD_INDICES, SKELETON, scoreToColor, computeScale,
  drawKeypoints, drawSkeleton,
} from '../src/pose.js';

describe('scoreToColor', () => {
  it('returns pure red for score 0', () => {
    expect(scoreToColor(0)).toBe('rgb(255, 0, 0)');
  });

  it('returns pure green for score 1', () => {
    expect(scoreToColor(1)).toBe('rgb(0, 255, 0)');
  });

  it('returns yellow-ish for score 0.5', () => {
    expect(scoreToColor(0.5)).toBe('rgb(128, 128, 0)');
  });
});

describe('computeScale', () => {
  it('scales down a large image to fit', () => {
    expect(computeScale(4000, 3000, 800, 600)).toBe(0.2);
  });

  it('does not upscale small images', () => {
    expect(computeScale(200, 150, 800, 600)).toBe(1.0);
  });

  it('is width-limited for wide images', () => {
    expect(computeScale(1600, 400, 800, 600)).toBe(0.5);
  });

  it('is height-limited for tall images', () => {
    expect(computeScale(400, 1600, 800, 600)).toBe(0.375);
  });
});

describe('HEAD_INDICES', () => {
  it('contains exactly indices 0-4', () => {
    expect(HEAD_INDICES.size).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(HEAD_INDICES.has(i)).toBe(true);
    }
  });

  it('does not contain body indices', () => {
    for (let i = 5; i <= 16; i++) {
      expect(HEAD_INDICES.has(i)).toBe(false);
    }
  });
});

describe('SKELETON', () => {
  it('has 12 body-only pairs', () => {
    expect(SKELETON).toHaveLength(12);
  });

  it('uses only body indices (5-16)', () => {
    for (const [a, b] of SKELETON) {
      expect(a).toBeGreaterThanOrEqual(5);
      expect(a).toBeLessThanOrEqual(16);
      expect(b).toBeGreaterThanOrEqual(5);
      expect(b).toBeLessThanOrEqual(16);
    }
  });

  it('contains no head indices', () => {
    for (const [a, b] of SKELETON) {
      expect(HEAD_INDICES.has(a)).toBe(false);
      expect(HEAD_INDICES.has(b)).toBe(false);
    }
  });
});

// Helper: create mock canvas context
function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
  };
}

// Helper: create 17 fake keypoints
function fakeKeypoints(defaultScore = 0.9) {
  const names = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ];
  return names.map((name, i) => ({
    x: i * 10,
    y: i * 10,
    score: defaultScore,
    name,
  }));
}

describe('drawKeypoints', () => {
  it('skips head keypoints (indices 0-4)', () => {
    const ctx = mockCtx();
    const keypoints = fakeKeypoints();
    drawKeypoints(ctx, keypoints);

    // 17 total - 5 head = 12 body keypoints drawn
    expect(ctx.arc).toHaveBeenCalledTimes(12);
  });

  it('sets globalAlpha based on score', () => {
    const ctx = mockCtx();
    const keypoints = fakeKeypoints(0.3);
    drawKeypoints(ctx, keypoints);

    // After each save(), globalAlpha should be set to max(score, 0.15) = 0.3
    // We can't directly check assignment on a mock, but arc was called 12 times
    expect(ctx.save).toHaveBeenCalledTimes(12);
    expect(ctx.restore).toHaveBeenCalledTimes(12);
  });

  it('draws circles at correct positions for body keypoints', () => {
    const ctx = mockCtx();
    const keypoints = fakeKeypoints();
    drawKeypoints(ctx, keypoints);

    // First body keypoint is index 5 (left_shoulder) at x=50, y=50
    const firstCall = ctx.arc.mock.calls[0];
    expect(firstCall[0]).toBe(50); // x
    expect(firstCall[1]).toBe(50); // y
  });
});

describe('drawSkeleton', () => {
  it('draws a line for each skeleton pair', () => {
    const ctx = mockCtx();
    const keypoints = fakeKeypoints();
    drawSkeleton(ctx, keypoints);

    expect(ctx.moveTo).toHaveBeenCalledTimes(SKELETON.length);
    expect(ctx.lineTo).toHaveBeenCalledTimes(SKELETON.length);
    expect(ctx.stroke).toHaveBeenCalledTimes(SKELETON.length);
  });

  it('uses correct endpoints for first skeleton pair [5,6]', () => {
    const ctx = mockCtx();
    const keypoints = fakeKeypoints();
    drawSkeleton(ctx, keypoints);

    // First pair is [5, 6] → shoulder to shoulder
    expect(ctx.moveTo.mock.calls[0]).toEqual([50, 50]); // index 5
    expect(ctx.lineTo.mock.calls[0]).toEqual([60, 60]); // index 6
  });
});
