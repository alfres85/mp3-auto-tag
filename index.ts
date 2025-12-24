import { scanForMp3 } from './src/scanner/fileScanner.js';
import { readTag } from './src/metadata/id3Reader.js';
import { writeCover, writeTags } from './src/metadata/id3Writer.js';
import { resolveCover } from './src/cover/resolver.js';
import { log } from './src/utils/logger.js';
import { parseFilename } from './src/utils/filenameParser.js';
import { searchRecording } from './src/cover/musicbrainz.js';
import fs from 'fs';

import PQueue from 'p-queue';

async function run(processedFiles: Set<string>) {
  const target = process.argv[2] || './music';

  log.info(`Scanning: ${target}`);
  const files = await scanForMp3(target);
  log.info(`Found ${files.length} MP3 files`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (processedFiles.has(file)) continue;

    let tag = readTag(file);

    if (tag.image) {
      log.info(`(${i + 1}/${files.length}) Skipping: ${file} (Cover already exists)`);
      processedFiles.add(file);
      continue;
    }

    log.info(`(${i + 1}/${files.length}) Processing: ${file}`);

    if (!tag.artist || !tag.album) {
      log.info('Missing metadata, attempting to fetch from filename');
      const parsed = parseFilename(file);
      if (parsed.title) {
        log.info(
          `Searching MusicBrainz for: ${parsed.artist ? parsed.artist + ' - ' : ''}${parsed.title}`
        );
        let webMetadata = await searchRecording(parsed.artist, parsed.title);

        if (!webMetadata) {
          log.info('MusicBrainz search failed, trying iTunes fallback...');
          const { searchiTunesMetadata } = await import('./src/cover/itunes.js');
          webMetadata = await searchiTunesMetadata(parsed.artist, parsed.title);
        }

        if (webMetadata) {
          log.success(
            `Found metadata: ${webMetadata.artist} - ${webMetadata.title} (${webMetadata.album})`
          );
          writeTags(file, {
            artist: webMetadata.artist,
            album: webMetadata.album || undefined,
            title: webMetadata.title,
          });
          // Re-read tags after writing
          tag = readTag(file);
        } else {
          log.warn('Could not find metadata on MusicBrainz');
        }
      } else {
        log.warn('Could not parse title from filename');
      }
    }

    if (!tag.artist || !tag.album) {
      log.warn('Still missing metadata, skipping cover search');
      processedFiles.add(file);
      continue;
    }

    const coverPath = await resolveCover(tag.artist, tag.album);
    if (!coverPath) {
      log.warn('No cover found');
      processedFiles.add(file);
      continue;
    }

    const img = fs.readFileSync(coverPath);
    writeCover(file, img);

    log.success('Cover embedded');
    processedFiles.add(file);
  }
}

async function main() {
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const processedFiles = new Set<string>();

  while (true) {
    try {
      await run(processedFiles);
      break; // Exit loop if run() completes successfully
    } catch (err) {
      log.error(`Fatal error: ${String(err)}`);
      log.info(`Restarting process in 5 minutes...`);
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));
    }
  }
}

main().catch((err) => log.error(String(err)));
