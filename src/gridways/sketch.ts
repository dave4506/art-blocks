import {
  Bound,
  Cord,
  Color,
  Line,
  Rect,
  SketchContext,
  RectByTriangle,
  Range,
  Animation,
} from '../types';
import * as createRegl from 'regl';
import * as glslify from 'glslify';
import * as seedrandom from 'seedrandom';
import * as SimplexNoise from 'simplex-noise';

import { convertHexToColor } from '../utils/color';
import { randomRangeFactory } from '../utils/random';
import { newArray } from '../utils';

import { flatten } from 'lodash';
import { rectToTriangles } from '../utils/primitives';
import { darken, toColorString } from 'polished';
import { easeInOutElastic, easeOutElastic } from '../utils/easing';

export const PPI = 300;
export const DIMENSIONS = [PPI * 12, PPI * 12];

export interface ColorPallete {
  colors: string[];
  tintColors: string[];
  pointilism?: number;
  type: string;
}

export interface SimpleColorPallete extends ColorPallete {
  colorRatios: number[];
  type: 'simple';
}

export interface GradientColorPallete extends ColorPallete {
  type: 'gradient';
}

interface Options {}

//Gene type all visual elements are in pixels unless specified
export interface Gene {
  seed: string;
  animation: {
    // animation related properties
    endDelayInTicks: number; // after the end of the animation, number of ticks to hold at the last frame before restarting
    startDelayInTicks: number; //before the animation, number of ticks to hold at first frame before starting
    breathDurationInTicksPerUnit: number; // the amount of ticks to animate for each unit in the grid
    bloomMaxStartDelayInTicks: number; // the max amount of ticks that the rects can start animation, bloom refers to the effect of some rects starting after others
  };
  parallax: {
    // parallax effect related properties
    offsetStrength: Cord; // strength of how much x,y offset of the grid due to offset
    depthStrength: number; // strength of z offset of the grid due to offset
    rotationStrength: number; // strength of rotational transformation to rects due to offset
    animationTickCount: number; // animation tick count to return to resting offset state
  };
  foreground: {
    // foreground rect related preperties
    pointilism: number; // simplex coefficient for the tinting effect on rects
    colorPointilism: number; // simplex coefficient for color grouping
    colorPalletes: ColorPallete[]; // color palletes to use in the work
    colorPalletesRatio: number[]; // ratio of each color pallete to be painted in the piece
    colorSprinkleRatio: number; // random injection of color into grid
    colorPalletesSprinkleRatio: number[]; // ratio of each color pallete when randomly injecting
  };
  background: {
    colors: [string, string]; // background color, two for the gradient
    tintColor: string; // tinting/texture color
    pointilism: number; // simplex coefficient for tint color texture
  };
  gridLinesToRects: {
    gitter: Range; // ratio of the gap from [0,1] that the rect can be slightly offset to
  };
  gridPartitioning: {
    gap: number; // gap in pixels between rects
    unitSize: Bound; // size of a unit in the grid in pixels
    gridSizeInUnits: Bound; // grid size in units of the grid
  };
}

const DEFAULT_GENE: Gene = {
  seed: '0xdf943cd665a62371192d37cde3ce31b2da26f3818044285714f982b19df018f0',
  animation: {
    startDelayInTicks: 1000,
    endDelayInTicks: 0,
    breathDurationInTicksPerUnit: 80,
    bloomMaxStartDelayInTicks: 300,
  },
  parallax: {
    offsetStrength: [0.02, 0.02],
    depthStrength: 0.5,
    rotationStrength: 0.005,
    animationTickCount: 10,
  },
  foreground: {
    pointilism: 0.6,
    colorPalletes: [
      {
        colors: ['#056676', '#5eaaa8', '#a3d2ca'],
        tintColors: ['#f6f5f5', '#f6f5f5', '#f6f5f5'],
        colorRatios: [0.33, 0.33, 0.34],
        type: 'simple',
      } as SimpleColorPallete,
      {
        colors: ['#ffc7c7', '#ffe2e2', '#f6f6f6'],
        tintColors: ['#f6f5f5', '#f6f5f5', '#f6f5f5'],
        colorRatios: [0.33, 0.33, 0.34],
        type: 'simple',
      } as SimpleColorPallete,
      {
        colors: ['#9ab3f5', '#a3d8f4', '#b9fffc'],
        tintColors: ['#7579e7', '#7579e7', '#7579e7'],
        colorRatios: [0.33, 0.33, 0.34],
        type: 'simple',
      } as SimpleColorPallete,
      {
        colors: ['#555555', '#cdc9c3', '#fbf7f0'],
        tintColors: ['#d9e4dd', '#d9e4dd', '#d9e4dd'],
        colorRatios: [0.33, 0.33, 0.34],
        type: 'simple',
      } as SimpleColorPallete,
      {
        colors: ['#fecd1a', '#fd3a69'],
        tintColors: ['#120078'],
        pointilism: 0.001,
        type: 'gradient',
      } as GradientColorPallete,
    ],
    colorPalletesRatio: [0.25, 0.25, 0.25, 0.25],
    colorSprinkleRatio: 0.01,
    colorPalletesSprinkleRatio: [0, 0, 0, 0, 1],
    colorPointilism: 0.01,
  },
  background: {
    colors: ['#14274e', '#394867'],
    tintColor: '#f6f6f6',
    pointilism: 0.08,
  },
  gridLinesToRects: {
    gitter: [0, 0],
  },
  gridPartitioning: {
    gap: 50,
    unitSize: [50, 50],
    gridSizeInUnits: [20, 30],
  },
};

export const sketch = async (gene: Gene = DEFAULT_GENE) => {
  const rand = seedrandom(gene.seed);
  const simplex = new SimplexNoise(gene.seed);
  const {
    randomByWeights,
    random,
    randomInArrayByWeights,
  } = randomRangeFactory(rand);
  return (sketchContext: SketchContext, options: Options) => {
    console.log(sketchContext);
    const { gl } = sketchContext;

    let mouseCords = [0, 0];
    let isMouseInCanvas = false;

    const {
      parallax,
      foreground,
      background,
      gridPartitioning,
      gridLinesToRects,
      animation,
    } = gene;

    const regl = createRegl({ gl });

    const start = () => {
      regl.poll();
      regl.clear({
        color: convertHexToColor('#ffffff'),
      });
    };

    // broad strokes assumption these are non overlapping
    const drawSimpleRects = (
      rects: Rect[],
      rectProps: any[],
      globalProps: any,
    ) => {
      const triangles = rects.map(rectToTriangles);

      interface CommandProps {
        fromColor: Color;
        toColor: Color;
        tintColor: Color;
        position: Cord[];
        rect: Rect;
        isVert: boolean;
        zIndex: number;
        pointilism: number;
      }

      const command = regl({
        frag: glslify(`
                        precision mediump float;

                        #pragma glslify: noise = require('glsl-noise/simplex/2d');
                        #pragma glslify: random = require(glsl-random);

                        // uniforms
                        uniform vec4 tintColor;
                        uniform vec4 fromColor;
                        uniform vec4 toColor;
                        uniform float pointilism;
                        uniform vec2 resolution;
                        uniform bool isVert;

                        // varyings 
                        varying float gradientMixRatio;

                        void main () {
                            vec2 cord = gl_FragCoord.xy / resolution;
                            vec4 color = mix(toColor, fromColor, gradientMixRatio);
                            float smooth_coeff = abs(noise(cord.xy * pointilism));
                            float noise_coeff = random(cord.xy);
                            float coeff = smooth_coeff * noise_coeff;
                            gl_FragColor = mix(color, tintColor, coeff);
                        }
                    `),
        vert: glslify(`
                        precision mediump float;

                        #pragma glslify: rotate = require(glsl-rotate)

                        // uniforms
                        uniform vec2 resolution;
                        uniform vec2 offset;
                        uniform float zIndex;
                        uniform float depthStrength;
                        uniform float rotationStrength;
                        uniform bool isVert;
                        uniform vec2 topLeft;
                        uniform vec2 bottomRight;

                        // attributes
                        attribute vec2 position;

                        // varying
                        varying float gradientMixRatio;

                        void main () {
                            gradientMixRatio = isVert ? (position.y - topLeft[1]) / (bottomRight[1] - topLeft[1]) : (position.x - topLeft[0]) / (bottomRight[0] - topLeft[0]); 
                            vec3 xAxis = vec3(0.0, 1.0, 0.0);
                            vec3 yAxis = vec3(1.0, 0.0, 0.0);
                            vec2 normalizedCords = vec2(2, 2) * ((position + (offset * depthStrength * zIndex)) / resolution);
                            normalizedCords *= vec2(1, -1);
                            normalizedCords += vec2(-1, 1);
                            vec3 pos = rotate(rotate(vec3(normalizedCords, 0), xAxis, 1.0 * rotationStrength * offset[0]), yAxis, -1.0 * rotationStrength * offset[1]);
                            gl_Position = vec4(pos.xy, 0, 1);
                        }
                    `),
        primitive: 'triangles',
        attributes: {
          position: regl.prop<CommandProps, 'position'>('position'),
        },
        uniforms: {
          resolution: [sketchContext.width, sketchContext.height],
          pointilism: regl.prop<CommandProps, 'pointilism'>('pointilism'),
          topLeft: (_, props: CommandProps) => props.rect[0],
          bottomRight: (_, props: CommandProps) => props.rect[1],
          offset: globalProps.offset,
          depthStrength: parallax.depthStrength,
          rotationStrength: parallax.rotationStrength,
          fromColor: regl.prop<CommandProps, 'fromColor'>('fromColor'),
          toColor: regl.prop<CommandProps, 'toColor'>('toColor'),
          tintColor: regl.prop<CommandProps, 'tintColor'>('tintColor'),
          isVert: regl.prop<CommandProps, 'isVert'>('isVert'),
          zIndex: regl.prop<CommandProps, 'zIndex'>('zIndex'),
        },
        count: 6,
      });

      const batchedProps: CommandProps[] = triangles.map((t, i) => {
        const rect = rects[i];
        return {
          fromColor: convertHexToColor(rectProps[i].fromColor),
          toColor: convertHexToColor(rectProps[i].toColor),
          tintColor: convertHexToColor(rectProps[i].tintColor),
          position: [...t[0], ...t[1]],
          rect,
          isVert: rectProps[i].isVert,
          zIndex: rectProps[i].zIndex,
          pointilism: rectProps[i].pointilism ?? foreground.pointilism,
        };
      });

      command(batchedProps);
    };

    const drawBackground = () => {
      const triangles = rectToTriangles([
        [0, 0],
        [sketchContext.width, sketchContext.height],
      ]);

      interface CommandProps {
        fromColor: Color;
        toColor: Color;
        tintColor: Color;
        position: Cord[];
      }

      const command = regl({
        frag: glslify(`
                        precision mediump float;

                        #pragma glslify: noise = require('glsl-noise/simplex/2d');
                        #pragma glslify: random = require(glsl-random);

                        uniform vec4 backgroundColor;
                        uniform vec4 tintColor;
                        uniform vec4 fromColor;
                        uniform vec4 toColor;
                        uniform float pointilism;
                        uniform vec2 resolution;
                        
                        void main () {
                            vec2 cord = gl_FragCoord.xy / resolution;
                            vec4 color = mix(toColor, fromColor, cord.x);
                            float smooth_coeff = abs(noise(cord.xy * pointilism));
                            float noise_coeff = random(cord.xy);
                            float coeff = smooth_coeff * noise_coeff;
                            gl_FragColor = mix(color, tintColor, coeff);
                        }
                    `),
        vert: glslify(`
                        precision mediump float;

                        // uniforms
                        uniform vec2 resolution;

                        // attributes
                        attribute vec2 position;

                        void main () {
                            vec2 normalizedCords = vec2(2, 2) * (position / resolution);
                            normalizedCords *= vec2(1, -1);
                            normalizedCords += vec2(-1, 1);
                            gl_Position = vec4(normalizedCords, 0, 1);
                        }
                    `),
        primitive: 'triangles',
        attributes: {
          position: regl.prop<CommandProps, 'position'>('position'),
        },
        uniforms: {
          resolution: [sketchContext.width, sketchContext.height],
          pointilism: background.pointilism,
          toColor: regl.prop<CommandProps, 'toColor'>('toColor'),
          fromColor: regl.prop<CommandProps, 'fromColor'>('fromColor'),
          tintColor: regl.prop<CommandProps, 'tintColor'>('tintColor'),
        },
        count: 6,
      });

      command({
        fromColor: convertHexToColor(background.colors[0]),
        toColor: convertHexToColor(background.colors[1]),
        tintColor: convertHexToColor(background.tintColor),
        position: [...triangles[0], ...triangles[1]],
      });
    };

    // generates partitions in the units of the gridSize
    const generateGridPartitioningInGridUnits = (
      topLeft: Cord,
      bottomRight: Cord,
      vertOrHorzRatio = 0.5,
    ): Line[] => {
      // if bounds is in effect a dot
      if (
        bottomRight[0] - topLeft[0] === 0 &&
        bottomRight[1] - topLeft[1] === 0
      ) {
        return [[topLeft, bottomRight]];
      }
      let isVert = rand() > vertOrHorzRatio;
      // if bound is a 1 by 2 line
      if (
        (bottomRight[0] - topLeft[0] === 1 &&
          bottomRight[1] - topLeft[1] === 0) ||
        (bottomRight[0] - topLeft[0] === 0 && bottomRight[1] - topLeft[1] === 1)
      ) {
        return [
          [topLeft, topLeft],
          [bottomRight, bottomRight],
        ];
      }
      // if bounds is in effect a 2 by 2 square
      if (
        bottomRight[0] - topLeft[0] === 1 &&
        bottomRight[1] - topLeft[1] === 1
      ) {
        if (isVert) {
          return [
            [topLeft, [bottomRight[0] - 1, bottomRight[1]]],
            [[topLeft[0] + 1, topLeft[1]], bottomRight],
          ];
        } else {
          return [
            [topLeft, [bottomRight[0], bottomRight[1] - 1]],
            [[topLeft[0], topLeft[1] + 1], bottomRight],
          ];
        }
      }

      const startPt: Cord = [
        isVert ? random(topLeft[0] + 1, bottomRight[0], 'int') : topLeft[0],
        isVert ? topLeft[1] : random(topLeft[1] + 1, bottomRight[1], 'int'),
      ];
      const endPt: Cord = [
        isVert ? startPt[0] : bottomRight[0],
        isVert ? bottomRight[1] : startPt[1],
      ];
      const line: Line = [startPt, endPt];
      const topOrLeftRect: Rect = [
        topLeft,
        [endPt[0] - (isVert ? 1 : 0), endPt[1] - (isVert ? 0 : 1)],
      ];
      const bottomOrRightRect: Rect = [
        [startPt[0] + (isVert ? 1 : 0), startPt[1] + (isVert ? 0 : 1)],
        bottomRight,
      ];
      // check if bounds are valid, if not provide no lines
      const isTopOrLeftRectValid =
        topOrLeftRect[1][0] >= topOrLeftRect[0][0] &&
        topOrLeftRect[1][1] >= topOrLeftRect[0][1];
      const isBottomOrRightRectValid =
        bottomOrRightRect[1][0] >= bottomOrRightRect[0][0] &&
        bottomOrRightRect[1][1] >= bottomOrRightRect[0][1];

      const ratio = !isVert
        ? vertOrHorzRatio / 2
        : vertOrHorzRatio + (1 - vertOrHorzRatio) / 2;
      return [
        ...(isTopOrLeftRectValid
          ? generateGridPartitioningInGridUnits(
              topOrLeftRect[0],
              topOrLeftRect[1],
              ratio,
            )
          : []),
        line,
        ...(isBottomOrRightRectValid
          ? generateGridPartitioningInGridUnits(
              bottomOrRightRect[0],
              bottomOrRightRect[1],
              ratio,
            )
          : []),
      ];
    };

    const convertGridLinesToRects = (
      lines: Line[],
      lineProps: any[],
    ): Rect[] => {
      const { unitSize, gridSizeInUnits, gap } = gridPartitioning;

      const totalGridBounds = [
        unitSize[0] * gridSizeInUnits[0] + gap * (gridSizeInUnits[0] - 1),
        unitSize[1] * gridSizeInUnits[1] + gap * (gridSizeInUnits[1] - 1),
      ];

      const topLeft = [
        (sketchContext.width - totalGridBounds[0]) / 2,
        (sketchContext.height - totalGridBounds[1]) / 2,
      ];

      return lines
        .map((l, i) => {
          return [
            [l[0][0] * (unitSize[0] + gap), l[0][1] * (unitSize[1] + gap)],
            [
              (l[1][0] + lineProps[i].gitterRatio[0]) * (unitSize[0] + gap) -
                gap,
              (l[1][1] + lineProps[i].gitterRatio[1]) * (unitSize[1] + gap) -
                gap,
            ],
          ];
        })
        .map((r) => {
          return [
            [topLeft[0] + r[0][0], topLeft[1] + r[0][1]],
            [topLeft[0] + r[1][0], topLeft[1] + r[1][1]],
          ];
        });
    };

    const getAnimatedLinesWithAnimations = (
      lines: Line[],
      tick: number,
      anim: Animation,
    ): Line[] => {
      //assumes that the anim feed is the duration of the animation
      const completeTicksDuration =
        anim.startDelayInTicks + anim.durationInTicks + anim.endDelayInTicks;
      // for looping, the tick is set to cycle [0, completeTicksDuration]
      const relativeTick = tick % completeTicksDuration;
      if (relativeTick < anim.startDelayInTicks) {
        return lines.map((l) => animateLine(l, 'static', 1));
      }
      if (
        relativeTick >= anim.startDelayInTicks &&
        relativeTick < completeTicksDuration - anim.endDelayInTicks
      ) {
        if (anim.type === 'timeline') {
          const lineGroups: Line[][] = anim.subAnimations.map(
            (a: Animation) => {
              const pickedLine = lines[a.props.lineIndex as number];
              return getAnimatedLinesWithAnimations(
                [pickedLine],
                relativeTick - anim.startDelayInTicks,
                a,
              );
            },
          );
          return flatten(lineGroups);
        }
        if (anim.type === 'breath') {
          const relativeTickToDuration = relativeTick - anim.startDelayInTicks;
          const animationSequence: AnimateLineType[] = [
            'start-expand',
            'start-suck',
            'end-suck',
            'end-expand',
          ];
          const sequenceDurationInTicks =
            anim.durationInTicks / animationSequence.length;
          const proportion =
            (relativeTickToDuration % sequenceDurationInTicks) /
            sequenceDurationInTicks;
          const animationIndex = Math.floor(
            relativeTickToDuration / sequenceDurationInTicks,
          );
          return lines.map((l) =>
            animateLine(l, animationSequence[animationIndex], proportion),
          );
        }
        return lines.map((l) => animateLine(l, 'static', 1));
      }
      if (relativeTick >= completeTicksDuration - anim.endDelayInTicks) {
        return lines.map((l) => animateLine(l, 'static', 1));
      }
      return lines;
    };

    type AnimateLineType =
      | 'static'
      | 'start-suck'
      | 'start-expand'
      | 'end-suck'
      | 'end-expand';

    const animateLine = (
      l: Line,
      type: AnimateLineType,
      proportion: number,
    ): Line => {
      let startRatio = 0;
      let endRatio = 0;
      if (type === 'static') {
        endRatio = proportion;
      }
      if (type === 'start-suck') {
        endRatio = 1;
        startRatio = 1 - easeOutElastic(proportion);
      }
      if (type === 'start-expand') {
        endRatio = 1;
        startRatio = easeOutElastic(proportion);
      }
      if (type === 'end-suck') {
        endRatio = 1 - easeOutElastic(proportion);
        startRatio = 0;
      }
      if (type === 'end-expand') {
        endRatio = easeOutElastic(proportion);
        startRatio = 0;
      }
      // if vert, scale the y value
      if (l[1][0] - l[0][0] === 0) {
        return [
          [l[0][0], l[0][1] + (l[1][1] - l[0][1]) * startRatio],
          [l[1][0], l[0][1] + (l[1][1] - l[0][1]) * endRatio],
        ];
      }
      // if horz, scale the x value
      if (l[1][1] - l[0][1] === 0) {
        return [
          [l[0][0] + (l[1][0] - l[0][0]) * startRatio, l[0][1]],
          [l[0][0] + (l[1][0] - l[0][0]) * endRatio, l[1][1]],
        ];
      }
      return l;
    };

    const animate = () => {
      const { offsetStrength } = parallax;
      const { gitter } = gridLinesToRects;
      const { gridSizeInUnits } = gridPartitioning;
      const lines = generateGridPartitioningInGridUnits(
        [0, 0],
        [gridSizeInUnits[0] - 1, gridSizeInUnits[1] - 1],
      );
      const lineProps = lines.map((l) => {
        const gitterRatio = [1 - random(...gitter), 1 - random(...gitter)];
        return {
          gitterRatio,
        };
      });

      const colorPtOffset = [random(0, 10000, 'int'), random(0, 10000, 'int')];
      const rectProps = newArray(lines.length).map((_: any, i: number) => {
        const isVert = lines[i][0][0] === lines[i][1][0];
        const colorPt: Cord = [
          foreground.colorPointilism *
            ((lines[i][0][0] + lines[i][1][0]) / 2 + colorPtOffset[0]),
          foreground.colorPointilism *
            ((lines[i][0][1] + lines[i][1][1]) / 2 + colorPtOffset[1]),
        ];

        let colorPalleteIndex = (() => {
          // generally simplex has a noise from [0.7xx, 0.7xx]
          let colorPalleteNormalizedValue = Math.min(
            Math.abs(simplex.noise2D(...colorPt)) / 0.7,
            0.99,
          );
          for (let i = 0; i < foreground.colorPalletesRatio.length; i++) {
            if (
              colorPalleteNormalizedValue < foreground.colorPalletesRatio[i]
            ) {
              return i;
            }

            colorPalleteNormalizedValue -= foreground.colorPalletesRatio[i];
          }
          return -1;
        })();

        if (rand() < foreground.colorSprinkleRatio) {
          colorPalleteIndex = randomByWeights(
            foreground.colorPalletesSprinkleRatio,
          );
        }

        const startDelayInTicks = Math.floor(
          animation.bloomMaxStartDelayInTicks *
            (Math.abs(
              simplex.noise2D(
                colorPt[0] * colorPalleteIndex,
                colorPt[1] * colorPalleteIndex,
              ),
            ) /
              0.9),
        );

        const breathDurationInTicks =
          animation.breathDurationInTicksPerUnit *
          ((isVert
            ? lines[i][1][1] - lines[i][0][1]
            : lines[i][1][0] - lines[i][0][0]) +
            1);

        if (foreground.colorPalletes[colorPalleteIndex].type === 'simple') {
          const colorPallete = foreground.colorPalletes[
            colorPalleteIndex
          ] as SimpleColorPallete;

          const colorIndex = randomByWeights(colorPallete.colorRatios);

          return {
            fromColor: colorPallete.colors[colorIndex],
            toColor: colorPallete.colors[colorIndex],
            tintColor: colorPallete.tintColors[colorIndex],
            isVert,
            zIndex: i % 10, // TODO
            startDelayInTicks,
            breathDurationInTicks,
          };
        }

        if (foreground.colorPalletes[colorPalleteIndex].type === 'gradient') {
          const colorPallete = foreground.colorPalletes[
            colorPalleteIndex
          ] as GradientColorPallete;
          // assumes only two colors and 1 tint
          return {
            fromColor: colorPallete.colors[0],
            toColor: colorPallete.colors[1],
            tintColor: colorPallete.tintColors[0],
            pointilism: colorPallete.pointilism,
            isVert,
            zIndex: (i % 10) + 1, // TODO
            startDelayInTicks,
            breathDurationInTicks,
          };
        }

        // invalid
        return {};
      });

      const backgroundRects = convertGridLinesToRects(lines, lineProps);
      const backgroundRectsProps = backgroundRects.map((r: any, i: number) => {
        const isVert = lines[i][0][0] === lines[i][1][0];
        return {
          fromColor: darken(0.05, background.colors[0]),
          toColor: darken(0.05, background.colors[1]),
          tintColor: darken(0.0001, background.colors[0]),
          pointilism: 0,
          isVert,
          zIndex: 0, // TODO
          startDelayInTicks: 0,
          breathDurationInTicks: 0,
        };
      });
      const durationInTicks =
        Math.max(...rectProps.map((r: any) => r.startDelayInTicks)) +
        Math.max(...rectProps.map((r: any) => r.breathDurationInTicks));

      const timelineAnimation: Animation = {
        startDelayInTicks: animation.startDelayInTicks,
        durationInTicks,
        endDelayInTicks: animation.endDelayInTicks,
        props: {},
        type: 'timeline',
        subAnimations: rectProps.map((r: any, i: number) => {
          return {
            startDelayInTicks: r.startDelayInTicks,
            durationInTicks: r.breathDurationInTicks,
            endDelayInTicks:
              durationInTicks - r.breathDurationInTicks - r.startDelayInTicks,
            props: { lineIndex: i },
            type: 'breath',
            subAnimations: [],
          };
        }),
      };

      let lastIsMouseInCanvasTick = 0;

      regl.frame(({ tick }) => {
        const animatedLines = getAnimatedLinesWithAnimations(
          lines,
          tick,
          timelineAnimation,
        );

        const rects = convertGridLinesToRects(animatedLines, lineProps);
        let offset = [
          (mouseCords[0] - sketchContext.width / 2) * offsetStrength[0] * -1,
          (mouseCords[1] - sketchContext.height / 2) * offsetStrength[1] * -1,
        ];
        if (!isMouseInCanvas) {
          const offsetReturnCoeff =
            1 -
            Math.pow(
              Math.min(
                tick - lastIsMouseInCanvasTick,
                parallax.animationTickCount,
              ) / parallax.animationTickCount,
              2,
            );
          offset = [
            offset[0] * offsetReturnCoeff,
            offset[1] * offsetReturnCoeff,
          ];
        } else {
          lastIsMouseInCanvasTick = tick;
        }
        const globalProps = {
          offset,
        };

        drawSimpleRects(rects, rectProps, globalProps);
        drawSimpleRects(backgroundRects, backgroundRectsProps, {
          offset: [0, 0],
        });
        drawBackground();
      });
    };

    return {
      render: () => {
        start();
        animate();
      },
      end: () => {
      },
    };
  };
};
