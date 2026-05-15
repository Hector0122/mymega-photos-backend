import { OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';
export declare class AppService implements OnApplicationBootstrap {
    private prisma;
    onApplicationBootstrap(): Promise<void>;
    private s3;
    constructor(prisma: PrismaService);
    private baseName;
    getPhotos(userId: string, cursor?: string, maxKeys?: number, query?: string, favoritesOnly?: boolean, blurryOnly?: boolean): Promise<{
        photos: {
            uri: string;
            date: string;
            id: string;
            favorite: boolean;
            tags: string[];
            blurred: boolean;
        }[];
        nextToken: string | null;
    }>;
    uploadPhoto(userId: string, buffer: Buffer, filename: string, lat?: number, lng?: number): Promise<string>;
    getPhotoUrl(userId: string, photoId: string): Promise<string>;
    getShareLink(userId: string, photoId: string, expiresIn?: number): Promise<string>;
    deletePhoto(userId: string, photoId: string): Promise<void>;
    toggleFavorite(userId: string, photoId: string): Promise<boolean>;
    addTag(userId: string, photoId: string, tag: string): Promise<string[]>;
    removeTag(userId: string, photoId: string, tag: string): Promise<string[]>;
    getGeotaggedPhotos(userId: string): Promise<{
        id: string;
        url: string;
        filename: string;
        lat: number | null;
        lng: number | null;
    }[]>;
    getThisDayPhotos(userId: string): Promise<{
        year: number;
        uri: string;
        id: string;
        filename: string;
        count: number;
        yearsAgo: number;
    }[]>;
    getStats(userId: string): Promise<{
        photoCount: number;
        albumCount: number;
        favoriteCount: number;
        blurryCount: number;
    }>;
    private computeBlurScore;
    private computePerceptualHash;
    analyzePhoto(photoId: string): Promise<{
        blurred: boolean;
        blurScore: number;
        perceptualHash: string;
    }>;
    analyzeAllPhotos(userId: string): Promise<{
        analyzed: number;
    }>;
    getDuplicates(userId: string): Promise<{
        id: string;
        url: string;
        filename: string;
        perceptualHash: string | null;
        blurred: boolean;
        blurScore: number | null;
        createdAt: Date;
    }[][]>;
    generateMissingThumbnails(): Promise<{
        generated: number;
    }>;
    migrateToFolders(): Promise<{
        moved: number;
    }>;
    syncS3ToDb(): Promise<{
        synced: number;
    }>;
    exportAllPhotos(userId: string): Promise<{
        message: string;
    }>;
}
