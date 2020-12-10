import canvasSketch from 'canvas-sketch';
import { DIMENSIONS, sketch } from './sketch';

(async () => {
  const sketchSettings = {
    prefix: '',
    name: '',
    dimensions: DIMENSIONS,
    animate: false,
    context: 'webgl',
    attributes: {
      antialias: true,
    },
  };
  canvasSketch(await sketch(), sketchSettings);
})();
