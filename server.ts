import multer from "multer";
import AdmZip from "adm-zip";
import express, { Request, Response } from "express";
import path from "path";
import { Info, loadInfo, readAudioDataFileSync, saveInfo, readDifficultyFileSync, readLightshowFileSync, writeDifficultyFileSync, writeAudioDataFile } from "bsmap";
import fs from "fs";
import { EventEmitter } from "events";

interface ConversionProgress {
    status: 'pending' | 'extracting' | 'converting' | 'compressing' | 'complete' | 'failed';
    message: string;
    progress: number;
    error?: string;
    startTime: number;
    lastUpdated: number;
}

const progressTracker = new Map<string, ConversionProgress>();
const progressEvent = new EventEmitter();

setInterval(() => {
    const now = Date.now();
    for (const [requestId, progress] of progressTracker) {
        if (now - progress.lastUpdated > 60 * 1000) {
            progressTracker.delete(requestId);
        }
    }
}, 60 * 1000);

function removeEmpty(o: any) {
    for (let key in o) {
        if (!o[key] || typeof o[key] !== "object") {
            continue;
        }

        removeEmpty(o[key]);
        if (Object.keys(o[key]).length === 0 && key === "customData") {
            delete o[key];
        }
    }
    return o;
}

function changeInfo(info: Info) {
    info.difficulties.forEach(diff => {
        diff.colorSchemeId = 0;
    });
}

function exists(filename: string, returnPath: boolean = false): boolean | any {
    try {
        const stats = fs.statSync(filename);
        if (stats.isDirectory()) {
            throw new Error(`Expected a file but found a directory: ${filename}`);
        }

        if (returnPath) {
            return path.join(filename);
        }

        const data = fs.readFileSync(filename, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error in exists function for file ${filename}:`, err);
        return false;
    }
}

function findFileInsensitive(dir: string, target: string): string | null {
    const files = fs.readdirSync(dir);
    const normalizedTarget = target.replace(/\s+/g, '').toLowerCase();
    for (const file of files) {
        if (file.replace(/\s+/g, '').toLowerCase() === normalizedTarget) {
            return path.join(dir, file);
        }
    }
    return null;
}

async function ConvertV4(inputDir: string, outputDir: string): Promise<boolean> {
    try {
        const infoPath = findFileInsensitive(inputDir, "Info.dat");
        if (!infoPath) {
            console.error("Info.dat not found in", inputDir);
            return false;
        }
        const infoFile = exists(infoPath);
        if (!infoFile) return false;
        const info = loadInfo(infoFile, 4) as Info;
        changeInfo(info);

        const audioPath = findFileInsensitive(inputDir, info.audio.audioDataFilename);
        if (!audioPath) {
            console.error("Audio file not found:", info.audio.audioDataFilename);
            return false;
        }
        const audioData = readAudioDataFileSync(audioPath).setFilename('BPMInfo.dat');
        writeAudioDataFile(audioData, 2);

        const bpmEvents = audioData.getBpmEvents();

        fs.writeFileSync(`${outputDir}/BPMInfo.dat`, JSON.stringify(audioData));

        for (const diff of info.difficulties) {
            const v4DiffFile = exists(path.join(inputDir, diff.filename), true);
            const v4Diff = readDifficultyFileSync(v4DiffFile);
            const v4LightshowFile = exists(path.join(inputDir, diff.lightshowFilename), true);
            const v4Lightshow = readLightshowFileSync(v4LightshowFile);
            v4Diff.lightshow = v4Lightshow.lightshow;

            if (audioData) {
                v4Diff.bpmEvents = [];
                v4Diff.addBpmEvents(...bpmEvents);
            }

            const newDiff = writeDifficultyFileSync(v4Diff, 3);

            const copy: any = JSON.parse(JSON.stringify(newDiff));
            const outputFilename = diff.characteristic === "Standard" ?
                `${diff.difficulty}.beatmap.dat` :
                `${diff.characteristic}${diff.difficulty}.beatmap.dat`;

            fs.writeFileSync(`${outputDir}/${outputFilename}`, JSON.stringify(removeEmpty(copy)));
        }

        const convertedInfo = saveInfo(info, 2);
        const infoCopy = JSON.parse(JSON.stringify(convertedInfo));
        fs.writeFileSync(`${outputDir}/Info.dat`, JSON.stringify(infoCopy));
        fs.writeFileSync(`${outputDir}/${info.audio.filename}`, fs.readFileSync(`${inputDir}/${info.audio.filename}`));

        if (info.coverImageFilename) {
            fs.writeFileSync(`${outputDir}/${info.coverImageFilename}`,
                fs.readFileSync(`${inputDir}/${info.coverImageFilename}`));
        }

        return true;
    } catch (e) {
        console.error("Conversion error:", e);
        return false;
    }
}

const storage = multer.diskStorage({
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage, limits: { fieldSize: 20 * 1024 * 1024 } });

export const uploadMiddleware = upload.fields([
    { name: "map", maxCount: 1 },
]);

interface MulterFile {
    map?: Express.Multer.File[];
}

// @ts-ignore
interface TypedRequest extends Request {
    files?: MulterFile;
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({ limit: "30mb", extended: true, parameterLimit: 10000 }));

app.get("/", (req, res) => {
    const html = String(fs.readFileSync(path.join(__dirname, "index.html")));
    res.send(html);
})

// @ts-ignore
app.post("/api/upload", uploadMiddleware, async (req: TypedRequest, res: Response) => {
    const mapZip = req.files?.map ? (req.files?.map as Express.Multer.File[])[0] : undefined

    if (!mapZip) {
        return res.status(400).send("No map provided.");
    }

    const requestId = Date.now() + '-' + Math.random().toString(36).substring(2, 10);
    const mapDir = path.join(__dirname, `map-${requestId}`);
    const convertedDir = path.join(__dirname, `converted-${requestId}`);

    progressTracker.set(requestId, {
        status: 'pending',
        message: 'Starting conversion process',
        progress: 0,
        startTime: Date.now(),
        lastUpdated: Date.now()
    });

    try {
        fs.mkdirSync(mapDir, { recursive: true });
        fs.mkdirSync(convertedDir, { recursive: true });

        progressTracker.set(requestId, {
            status: 'extracting',
            message: 'Extracting map files',
            progress: 20,
            startTime: progressTracker.get(requestId)!.startTime,
            lastUpdated: Date.now()
        });
        progressEvent.emit('progress', requestId);

        const convertedName = mapZip.filename.split(".")[0];
        const zipPath = path.join(mapZip.destination, mapZip.filename);

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(mapDir);

        progressTracker.set(requestId, {
            status: 'converting',
            message: 'Converting map to v2 format',
            progress: 40,
            startTime: progressTracker.get(requestId)!.startTime,
            lastUpdated: Date.now()
        });
        progressEvent.emit('progress', requestId);

        const converted = await ConvertV4(mapDir, convertedDir);

        if (!converted) {
            progressTracker.set(requestId, {
                status: 'failed',
                message: 'Conversion failed',
                progress: 0,
                error: 'Failed to convert map files',
                startTime: progressTracker.get(requestId)!.startTime,
                lastUpdated: Date.now()
            });
            progressEvent.emit('progress', requestId);
            throw new Error("Conversion failed");
        }

        progressTracker.set(requestId, {
            status: 'compressing',
            message: 'Creating converted zip file',
            progress: 80,
            startTime: progressTracker.get(requestId)!.startTime,
            lastUpdated: Date.now()
        });
        progressEvent.emit('progress', requestId);

        const newZip = new AdmZip();
        newZip.addLocalFolder(convertedDir);
        const buffer = newZip.toBuffer();

        progressTracker.set(requestId, {
            status: 'complete',
            message: 'Conversion complete',
            progress: 100,
            startTime: progressTracker.get(requestId)!.startTime,
            lastUpdated: Date.now()
        });
        progressEvent.emit('progress', requestId);

        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${convertedName}_converted.zip"`,
            'Content-Length': buffer.length,
            'X-Request-ID': requestId
        });

        res.send(buffer);
    } catch (error) {
        console.error("Error processing request:", error);

        if (progressTracker.get(requestId)?.status !== 'failed') {
            progressTracker.set(requestId, {
                status: 'failed',
                message: 'Conversion error occurred',
                progress: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
                startTime: progressTracker.get(requestId)!.startTime,
                lastUpdated: Date.now()
            });
            progressEvent.emit('progress', requestId);
        }

        res.status(500).send("Something went wrong during conversion.");
    } finally {
        res.on('finish', () => {
            try {
                if (mapZip && fs.existsSync(path.join(mapZip.destination, mapZip.filename))) {
                    fs.unlinkSync(path.join(mapZip.destination, mapZip.filename));
                }
                if (fs.existsSync(mapDir)) {
                    fs.rmSync(mapDir, { recursive: true, force: true });
                }
                if (fs.existsSync(convertedDir)) {
                    fs.rmSync(convertedDir, { recursive: true, force: true });
                }
            } catch (err) {
                console.error("Error during cleanup:", err);
            }
        });
    }
});

// @ts-ignore
app.get("/api/progress/:requestId", (req: Request, res: Response) => {
    const { requestId } = req.params;
    const progress = progressTracker.get(requestId);

    if (!progress) {
        return res.status(404).json({ error: "Request not found or expired" });
    }

    return res.json(progress);
});

// @ts-ignore
app.get("/api/progress-stream/:requestId", (req: Request, res: Response) => {
    const { requestId } = req.params;
    const progress = progressTracker.get(requestId);

    if (!progress) {
        return res.status(404).json({ error: "Request not found or expired" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify(progress)}\n\n`);

    const listener = (emittedRequestId: string) => {
        if (emittedRequestId === requestId) {
            const currentProgress = progressTracker.get(requestId);
            if (currentProgress) {
                res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);

                if (currentProgress.status === 'complete' || currentProgress.status === 'failed') {
                    res.end();
                }
            }
        }
    };

    progressEvent.on('progress', listener);

    req.on('close', () => {
        progressEvent.removeListener('progress', listener);
    });
});

app.listen(process.env.PORT || 3005, () => console.log("Listening on port", process.env.PORT || "3005"));
