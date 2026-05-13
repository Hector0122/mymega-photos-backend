import { OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';
export declare class AppService implements OnApplicationBootstrap {
    private prisma;
    onApplicationBootstrap(): Promise<void>;
    private s3;
    constructor(prisma: PrismaService);
    private baseName;
    getPhotos(userId: string, cursor?: string, maxKeys?: number, query?: string, favoritesOnly?: boolean): Promise<{
        photos: {
            uri: string;
            date: string;
            id: string;
            favorite: boolean;
            tags: string[];
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
        url: string;
        id: string;
        s3Key: string;
        filename: string;
        lat: number | null;
        lng: number | null;
    }[]>;
    generateMissingThumbnails(): Promise<{
        generated: number;
    }>;
    migrateToFolders(): Promise<{
        moved: number;
    }>;
    syncS3ToDb(): Promise<{
        synced: number;
    }>;
}
