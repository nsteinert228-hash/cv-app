// Exercise configurations
export const EXERCISES = {
  squat: {
    name: 'Squats',
    joints: {
      left:  [11, 13, 15],   // hip, knee, ankle
      right: [12, 14, 16],
    },
    upThreshold: 160,
    downThreshold: 100,
  },
  pushup: {
    name: 'Pushups',
    joints: {
      left:  [5, 7, 9],      // shoulder, elbow, wrist
      right: [6, 8, 10],
    },
    upThreshold: 160,
    downThreshold: 90,
  },
};

const MIN_CONFIDENCE = 0.3;
const HYSTERESIS = 5;

// Compute angle in degrees at point B, formed by points A-B-C
export function angleBetween(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBA === 0 || magBC === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

// Pick the side (left/right) with higher average keypoint confidence
export function pickBestSide(keypoints, exercise) {
  const leftJoints = exercise.joints.left;
  const rightJoints = exercise.joints.right;

  const leftConf = leftJoints.reduce((sum, i) => sum + keypoints[i].score, 0) / leftJoints.length;
  const rightConf = rightJoints.reduce((sum, i) => sum + keypoints[i].score, 0) / rightJoints.length;

  return leftConf >= rightConf ? 'left' : 'right';
}

// Get the exercise-relevant angle and min confidence for the best side
export function getExerciseAngle(keypoints, exercise) {
  const side = pickBestSide(keypoints, exercise);
  const [iA, iB, iC] = exercise.joints[side];
  const a = keypoints[iA];
  const b = keypoints[iB];
  const c = keypoints[iC];
  const confidence = Math.min(a.score, b.score, c.score);
  const angle = angleBetween(a, b, c);
  return { angle, confidence, side };
}

// States
const IDLE = 'idle';
const UP = 'up';
const DOWN = 'down';

export class RepCounter {
  constructor(exercise) {
    this.exercise = exercise;
    this.state = IDLE;
    this.count = 0;
    this.angle = 0;
  }

  update(keypoints) {
    const { angle, confidence } = getExerciseAngle(keypoints, this.exercise);
    this.angle = angle;

    // Skip frame if keypoints are too low confidence
    if (confidence < MIN_CONFIDENCE) {
      return { count: this.count, state: this.state, angle };
    }

    const { upThreshold, downThreshold } = this.exercise;

    switch (this.state) {
      case IDLE:
        if (angle > upThreshold) {
          this.state = UP;
        }
        break;

      case UP:
        if (angle < downThreshold - HYSTERESIS) {
          this.state = DOWN;
        }
        break;

      case DOWN:
        if (angle > upThreshold + HYSTERESIS) {
          this.state = UP;
          this.count++;
        }
        break;
    }

    return { count: this.count, state: this.state, angle };
  }

  reset() {
    this.state = IDLE;
    this.count = 0;
    this.angle = 0;
  }
}
