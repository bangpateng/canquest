import { IsString, MaxLength } from 'class-validator';

export class UploadAvatarDto {
  /** `data:image/...;base64,...` or raw base64 JPEG from client resize */
  @IsString()
  @MaxLength(3_000_000)
  image!: string;
}
