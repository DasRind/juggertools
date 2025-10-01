import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { TacticsStateService } from '../../core/tactics-state.service';

@Component({
  selector: 'app-site-header',
  standalone: true,
  templateUrl: './site-header.component.html',
  styleUrl: './site-header.component.scss',
})
export class SiteHeaderComponent implements AfterViewInit, OnDestroy {
  private readonly state = inject(TacticsStateService);
  @ViewChild('root', { static: true }) headerEl!: ElementRef<HTMLElement>;
  private resizeObs: ResizeObserver | null = null;
  private resizeFallback: (() => void) | null = null;

  readonly isDarkMode = this.state.isDarkMode;
  readonly themeToggleLabel = this.state.themeToggleLabel;

  toggleTheme(): void {
    this.state.toggleTheme();
  }

  ngAfterViewInit(): void {
    if (typeof document === 'undefined') return;
    const header = this.headerEl?.nativeElement;
    if (!header) return;

    const update = () => {
      const h = header.offsetHeight;
      document.documentElement.style.setProperty('--site-header-h', `${h}px`);
    };

    update();

    if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
      this.resizeObs = new ResizeObserver(() => update());
      this.resizeObs.observe(header);
    } else if (typeof window !== 'undefined') {
      const win = window as Window & typeof globalThis;
      const handler = () => update();
      win.addEventListener('resize', handler);
      this.resizeFallback = () => win.removeEventListener('resize', handler);
    }
  }

  ngOnDestroy(): void {
    if (this.resizeObs) {
      this.resizeObs.disconnect();
      this.resizeObs = null;
    }
    if (this.resizeFallback) {
      this.resizeFallback();
      this.resizeFallback = null;
    }
    if (typeof document !== 'undefined') {
      document.documentElement.style.removeProperty('--site-header-h');
    }
  }
}
