import { promises as fs } from 'fs';
import path from 'path';
import util from 'util';
import Jimp from 'jimp';

export async function bufferToFile(
  gl: any,
  width: number,
  height: number,
  filePath: string,
) {
  // Write output
  var bitmapData = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bitmapData);
  const image = new Jimp(width, height);
  image.bitmap.data = bitmapData as any;
  await new Promise((res) => {
    image.write(filePath, res);
  });
}
