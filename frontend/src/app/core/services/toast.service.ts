import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  show(message: string, duration = 3000): void {
    const toast = document.createElement('div');
    toast.className = 'shms-toast';
    toast.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      backgroundColor: '#071f1a',
      color: '#ffffff',
      padding: '12px 18px',
      borderRadius: '8px',
      border: '1px solid rgba(20, 184, 166, 0.35)',
      boxShadow: '0 10px 15px -3px rgba(7, 31, 26, 0.25), 0 4px 6px -4px rgba(7, 31, 26, 0.15)',
      fontSize: '0.875rem',
      fontWeight: '500',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      zIndex: '10000',
      opacity: '0',
      transform: 'translateY(8px)',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
      fontFamily: 'inherit'
    });
    const dot = toast.querySelector('.toast-dot') as HTMLElement;
    if (dot) {
      Object.assign(dot.style, {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: '#14b8a6',
        flexShrink: '0'
      });
    }
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => {
        if (toast.parentNode) {
          document.body.removeChild(toast);
        }
      }, 250);
    }, duration);
  }
}
