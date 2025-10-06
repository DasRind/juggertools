import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { TeamLoaderService } from '../team-loader.service';
import { GeneratorComponent } from './generator';

class TeamLoaderServiceStub {
  knownTeams: any[] = [];
  private readonly _selected = signal<string | null>(null);
  private readonly _loading = signal<string | null>(null);
  readonly selectedTeamId = this._selected.asReadonly();
  readonly loadingTeamId = this._loading.asReadonly();
  setSelectedTeam(id: string | null) {
    this._selected.set(id);
  }
  async loadTeam() {
    this._loading.set('demo');
    this._loading.set(null);
    return Promise.resolve({ teamName: 'Demo', players: [], teamLogo: '' });
  }
  async getPreview() {
    return Promise.resolve('');
  }
}

describe('GeneratorComponent', () => {
  let component: GeneratorComponent;
  let fixture: ComponentFixture<GeneratorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GeneratorComponent],
      providers: [
        provideRouter([]),
        { provide: TeamLoaderService, useClass: TeamLoaderServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GeneratorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
