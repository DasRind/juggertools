import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { ToastService } from '@juggertools/ui-angular';

describe('Analytics App', () => {
  let toast: ToastService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    localStorage.clear();
    toast.clearAll();
  });

  it('renders summary and actions', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain('Jugger Analytics');
    const buttons = Array.from(compiled.querySelectorAll('.actions button')).map((el) => el.textContent?.trim());
    expect(buttons).toEqual(expect.arrayContaining(['Sample-Spiel erfassen', 'Alles löschen']));
  });

  it('adds a sample game and persists it', async () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    component.addSampleGame();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.games().length).toBe(1);

    component.clearAll();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.games().length).toBe(0);
  });
});
