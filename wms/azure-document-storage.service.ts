import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { randomUUID } from 'node:crypto';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

@Injectable()
export class AzureDocumentStorageService {
  private readonly container?: ContainerClient;
  private ready?: Promise<unknown>;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>(
      'AZURE_STORAGE_CONNECTION_STRING',
    );
    if (connectionString) {
      const name =
        config.get<string>('AZURE_STORAGE_DOCUMENTS_CONTAINER') ||
        config.get<string>('AZURE_STORAGE_CONTAINER_NAME') ||
        'dossier-documents';
      this.container =
        BlobServiceClient.fromConnectionString(connectionString)
          .getContainerClient(name);
    }
  }

  validate(file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Fichier requis.');
    if (!ALLOWED_TYPES.has(file.mimetype))
      throw new BadRequestException(
        'Format non autorisé. Utilisez PDF, image, Word ou Excel.',
      );
    if (file.size > MAX_FILE_SIZE)
      throw new BadRequestException('Le fichier ne doit pas dépasser 20 Mo.');
  }

  async upload(
    tenantId: string,
    shipmentFileId: string,
    file: Express.Multer.File,
  ) {
    return this.uploadAt(`${tenantId}/${shipmentFileId}`, file);
  }

  async uploadInspection(
    tenantId: string,
    shipmentFileId: string,
    file: Express.Multer.File,
  ) {
    return this.uploadAt(`${tenantId}/${shipmentFileId}/inspections`, file);
  }

  private async uploadAt(prefix: string, file: Express.Multer.File) {
    this.validate(file);
    const container = await this.getContainer();
    const safeName = file.originalname
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .slice(-120);
    const blobName = `${prefix}/${randomUUID()}-${safeName}`;
    const blob = container.getBlockBlobClient(blobName);
    await blob.uploadData(file.buffer, {
      blobHTTPHeaders: { blobContentType: file.mimetype },
      metadata: {
        originalName: encodeURIComponent(file.originalname).slice(0, 1024),
      },
    });
    return blobName;
  }

  async download(blobName: string) {
    const response = await (await this.getContainer())
      .getBlobClient(blobName)
      .download();
    if (!response.readableStreamBody)
      throw new ServiceUnavailableException(
        'Le document ne peut pas être téléchargé.',
      );
    return {
      stream: response.readableStreamBody,
      contentType: response.contentType,
      contentLength: response.contentLength,
    };
  }

  async delete(blobName?: string | null) {
    if (!blobName) return;
    await (await this.getContainer())
      .getBlockBlobClient(blobName)
      .deleteIfExists({ deleteSnapshots: 'include' });
  }

  private async getContainer() {
    if (!this.container)
      throw new ServiceUnavailableException(
        'Le stockage Azure des documents n’est pas configuré.',
      );
    this.ready ??= this.container.createIfNotExists();
    await this.ready;
    return this.container;
  }
}
